import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { count, eq } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { buildApp } from '../app';
import { db, pool } from '../db/client';
import {
  auditLogs,
  deployments,
  logs,
  metrics,
  organizationMembers,
  organizations,
  services,
} from '../db/schema';
import { DEMO_ORG_NAME, DEMO_PASSWORD, DEMO_USERS, seed } from '../db/seed';
import { getEventsQueue } from '../events/queues';
import { resetDb, setupOrg, cookieFrom } from './helpers';

const app = buildApp();
afterAll(() => pool.end());
beforeEach(async () => {
  await getEventsQueue().obliterate({ force: true });
  await resetDb();
});

const countOf = async (table: PgTable) => (await db.select({ n: count() }).from(table))[0]!.n;

describe('seed', () => {
  it('creates the demo organization with users per role, 5 services, a week of metrics and history', async () => {
    const summary = await seed();
    expect(summary).toMatchObject({ services: 5, metrics: 5 * 7 * 24, deployments: 15 });
    expect(summary.logs).toBeGreaterThanOrEqual(40);
    expect(summary.logs).toBeLessThanOrEqual(60);

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.name, DEMO_ORG_NAME));
    const members = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, org!.id));
    expect(members.map((m) => m.role).sort()).toEqual(['ADMIN', 'ENGINEER', 'OWNER', 'VIEWER']);
    const names = (await db.select().from(services).where(eq(services.organizationId, org!.id)))
      .map((s) => s.slug)
      .sort();
    expect(names).toEqual([
      'auth-service',
      'notification-service',
      'order-service',
      'payment-service',
      'user-service',
    ]);
  });

  it('is repeatable: running it twice leaves exactly one demo organization', async () => {
    await seed();
    await seed();
    expect(
      await db.select().from(organizations).where(eq(organizations.name, DEMO_ORG_NAME)),
    ).toHaveLength(1);
    expect(await countOf(metrics)).toBe(5 * 7 * 24);
    expect(await countOf(deployments)).toBe(15);
  });

  it('the seeded users can sign in with the documented password', async () => {
    await seed();
    for (const u of DEMO_USERS) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: u.email, password: DEMO_PASSWORD });
      expect(res.status).toBe(200);
      const me = await request(app).get('/api/auth/me').set('cookie', cookieFrom(res));
      expect(me.body.role).toBe(u.role);
    }
  });
});

describe('simulate incident', () => {
  async function demoCookie(email: string) {
    const res = await request(app).post('/api/auth/login').send({ email, password: DEMO_PASSWORD });
    return cookieFrom(res);
  }

  it('creates the incident, error logs, degraded metrics, the v2.4.0 link and timeline entries', async () => {
    await seed();
    const admin = await demoCookie('demo-admin@opsflow.demo');
    const res = await request(app).post('/api/demo/simulate-incident').set('cookie', admin);
    expect(res.status).toBe(201);
    const { incident, logsInserted, deployment } = res.body;
    expect(incident).toMatchObject({
      severity: 'SEV1',
      priority: 'URGENT',
      status: 'OPEN',
      serviceName: 'Payment Service',
    });
    expect(deployment).toMatchObject({ version: 'v2.4.0', linked: true });
    expect(logsInserted).toBeGreaterThanOrEqual(40);
    expect(logsInserted).toBeLessThanOrEqual(60);

    // logs are attached to the incident, mostly the connection pool pattern
    const incidentLogs = (
      await request(app).get(`/api/logs?incidentId=${incident.id}&limit=200`).set('cookie', admin)
    ).body.items;
    expect(incidentLogs).toHaveLength(logsInserted);
    expect(
      incidentLogs.filter((l: { message: string }) =>
        l.message.includes('Connection pool exhausted'),
      ).length,
    ).toBeGreaterThan(10);
    expect(incidentLogs.some((l: { level: string }) => l.level === 'ERROR')).toBe(true);

    // degraded metrics and the service health followed
    const metric = (
      await request(app)
        .get(`/api/services/${incident.serviceId}/metrics/latest`)
        .set('cookie', admin)
    ).body.metric;
    expect(metric).toMatchObject({ healthStatus: 'DEGRADED', errorRate: 0.34 });
    const svc = (await request(app).get('/api/services').set('cookie', admin)).body.items.find(
      (s: { id: string }) => s.id === incident.serviceId,
    );
    expect(svc.status).toBe('DEGRADED');

    // the deployment ~15 minutes before the incident, linked, with timeline + audit
    const deps = (
      await request(app).get(`/api/incidents/${incident.id}/deployments`).set('cookie', admin)
    ).body.deployments;
    const bad = deps.find((d: { version: string }) => d.version === 'v2.4.0');
    expect(bad.linked).toBe(true);
    const minutesBefore = (Date.parse(incident.startedAt) - Date.parse(bad.deployedAt)) / 60_000;
    expect(minutesBefore).toBeGreaterThan(14);
    expect(minutesBefore).toBeLessThan(17);

    const detail = (await request(app).get(`/api/incidents/${incident.id}`).set('cookie', admin))
      .body;
    expect(detail.events.map((e: { eventType: string }) => e.eventType)).toEqual([
      'incident.created',
      'incident.deployment_linked',
    ]);
    const audit = (await db.select().from(auditLogs).where(eq(auditLogs.resourceId, incident.id)))
      .map((a) => a.action)
      .sort();
    expect(audit).toEqual(['incident.created', 'incident.deployment_linked']);

    // it behaved like real use: the normal domain event was queued for the worker
    expect(await getEventsQueue().getWaitingCount()).toBe(1);
  });

  it('can be replayed, reusing the recent v2.4.0 deployment', async () => {
    await seed();
    const admin = await demoCookie('demo-admin@opsflow.demo');
    const first = (await request(app).post('/api/demo/simulate-incident').set('cookie', admin))
      .body;
    const second = (await request(app).post('/api/demo/simulate-incident').set('cookie', admin))
      .body;
    expect(second.incident.id).not.toBe(first.incident.id);
    expect(second.deployment.id).toBe(first.deployment.id);
    expect(
      await db.select().from(deployments).where(eq(deployments.version, 'v2.4.0')),
    ).toHaveLength(1);
  });

  it('works in an organization that was never seeded, creating what it needs', async () => {
    const o = await setupOrg(app);
    const res = await request(app).post('/api/demo/simulate-incident').set('cookie', o.admin);
    expect(res.status).toBe(201);
    expect(res.body.incident.serviceName).toBe('Payment Service');
    expect(await countOf(logs)).toBe(res.body.logsInserted);
  });

  it('is limited to ADMIN and above', async () => {
    const o = await setupOrg(app);
    expect(
      (await request(app).post('/api/demo/simulate-incident').set('cookie', o.engineer)).status,
    ).toBe(403);
    expect(
      (await request(app).post('/api/demo/simulate-incident').set('cookie', o.viewer)).status,
    ).toBe(403);
    expect((await request(app).post('/api/demo/simulate-incident')).status).toBe(401);
  });
});
