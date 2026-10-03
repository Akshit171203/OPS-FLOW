import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { buildApp } from '../app';
import { db, pool } from '../db/client';
import { auditLogs } from '../db/schema';
import { createIncident, resetDb, setupOrg, type TestOrg } from './helpers';

const app = buildApp();
let o: TestOrg;

afterAll(() => pool.end());
beforeEach(async () => {
  await resetDb();
  o = await setupOrg(app);
});

const deploy = (cookie: string, over: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/deployments')
    .set('cookie', cookie)
    .send({ serviceId: o.serviceId, version: 'v1.0.0', commitSha: 'abc1234', ...over });
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

describe('deployments CRUD', () => {
  it('ENGINEER+ records a deployment, VIEWER cannot, everyone can list', async () => {
    const created = await deploy(o.engineer, { environment: 'staging', status: 'FAILED' });
    expect(created.status).toBe(201);
    expect(created.body.deployment).toMatchObject({
      version: 'v1.0.0',
      environment: 'staging',
      status: 'FAILED',
      serviceName: 'Payment Service',
    });
    expect((await deploy(o.viewer)).status).toBe(403);
    const list = await request(app).get('/api/deployments').set('cookie', o.viewer);
    expect(list.body).toMatchObject({ total: 1, page: 1, limit: 20 });
    expect(
      await db.select().from(auditLogs).where(eq(auditLogs.action, 'deployment.created')),
    ).toHaveLength(1);
  });

  it('validates input and scopes by organization', async () => {
    expect((await deploy(o.engineer, { commitSha: 'not hex!' })).status).toBe(400);
    const other = await setupOrg(app, 'b');
    expect((await deploy(o.engineer, { serviceId: other.serviceId })).status).toBe(404);
    await deploy(other.engineer, { serviceId: other.serviceId });
    expect((await request(app).get('/api/deployments').set('cookie', o.owner)).body.total).toBe(0);
  });

  it('lists newest first and filters by service', async () => {
    await deploy(o.engineer, { version: 'v1', deployedAt: hoursAgo(5) });
    await deploy(o.engineer, { version: 'v2', deployedAt: hoursAgo(1) });
    const res = await request(app)
      .get(`/api/deployments?serviceId=${o.serviceId}`)
      .set('cookie', o.viewer);
    expect(res.body.items.map((d: { version: string }) => d.version)).toEqual(['v2', 'v1']);
  });
});

describe('deployments for an incident', () => {
  it('returns only the incident service deployments inside the window, flagged by link state', async () => {
    const dep = async (version: string, h: number) =>
      (await deploy(o.engineer, { version, deployedAt: hoursAgo(h) })).body.deployment.id as string;
    const recent = await dep('recent', 0.25);
    await dep('yesterday', 30);
    await dep('last-week', 24 * 6);
    const incident = await createIncident(app, o.engineer, o.serviceId);

    const res = await request(app)
      .get(`/api/incidents/${incident.id}/deployments`)
      .set('cookie', o.viewer);
    expect(res.status).toBe(200);
    expect(res.body.deployments.map((d: { version: string }) => d.version)).toEqual([
      'recent',
      'yesterday',
    ]); // default window 48h
    expect(res.body.deployments.every((d: { linked: boolean }) => d.linked === false)).toBe(true);

    const wide = await request(app)
      .get(`/api/incidents/${incident.id}/deployments?windowHours=240`)
      .set('cookie', o.viewer);
    expect(wide.body.deployments).toHaveLength(3);
    const narrow = await request(app)
      .get(`/api/incidents/${incident.id}/deployments?windowHours=1`)
      .set('cookie', o.viewer);
    expect(narrow.body.deployments.map((d: { id: string }) => d.id)).toEqual([recent]);
  });

  it('linking writes a timeline event and an audit log, and flips the linked flag', async () => {
    const dep = (await deploy(o.engineer, { version: 'v2.4.0', deployedAt: hoursAgo(0.25) })).body
      .deployment.id;
    const incident = await createIncident(app, o.engineer, o.serviceId);
    const link = await request(app)
      .post(`/api/incidents/${incident.id}/deployments`)
      .set('cookie', o.engineer)
      .send({ deploymentId: dep });
    expect(link.status).toBe(201);

    const detail = await request(app).get(`/api/incidents/${incident.id}`).set('cookie', o.viewer);
    const linked = detail.body.events.find(
      (e: { eventType: string }) => e.eventType === 'incident.deployment_linked',
    );
    expect(linked.metadata).toMatchObject({ deploymentId: dep, version: 'v2.4.0' });
    expect(
      await db.select().from(auditLogs).where(eq(auditLogs.action, 'incident.deployment_linked')),
    ).toHaveLength(1);

    const list = await request(app)
      .get(`/api/incidents/${incident.id}/deployments`)
      .set('cookie', o.viewer);
    expect(list.body.deployments[0]).toMatchObject({ id: dep, linked: true });

    const again = await request(app)
      .post(`/api/incidents/${incident.id}/deployments`)
      .set('cookie', o.engineer)
      .send({ deploymentId: dep });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_LINKED');
  });

  it('rejects linking across services or organizations, and for VIEWERs', async () => {
    const other = await setupOrg(app, 'b');
    const otherDep = (await deploy(other.engineer, { serviceId: other.serviceId })).body.deployment
      .id;
    const incident = await createIncident(app, o.engineer, o.serviceId);
    const link = (cookie: string, deploymentId: string, id = incident.id) =>
      request(app)
        .post(`/api/incidents/${id}/deployments`)
        .set('cookie', cookie)
        .send({ deploymentId });

    expect((await link(o.engineer, otherDep)).status).toBe(404); // another org's deployment
    expect((await link(other.engineer, otherDep)).status).toBe(404); // another org's incident
    const second = (
      await request(app)
        .post('/api/services')
        .set('cookie', o.admin)
        .send({ projectId: o.projectId, name: 'Auth', slug: 'auth' })
    ).body.service.id;
    const authDep = (await deploy(o.engineer, { serviceId: second })).body.deployment.id;
    const mismatch = await link(o.engineer, authDep);
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.code).toBe('DEPLOYMENT_SERVICE_MISMATCH');
    expect((await link(o.viewer, authDep)).status).toBe(403);
    expect(
      (
        await request(app)
          .get(`/api/incidents/${incident.id}/deployments`)
          .set('cookie', other.owner)
      ).status,
    ).toBe(404);
  });
});
