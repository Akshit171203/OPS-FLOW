import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import request from './request';
import { buildApp } from '../app';
import { db, pool } from '../db/client';
import { incidents } from '../db/schema';
import { getOrSet, invalidate } from '../lib/cache';
import { getSharedRedis } from '../lib/redis';
import { createIncident, resetDb, setupOrg, sleep, type TestOrg } from './helpers';

const app = buildApp();
let o: TestOrg;

afterAll(() => pool.end());
beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDb();
  const redis = getSharedRedis();
  const keys = await redis.keys('opsflow-test:cache:*');
  if (keys.length) await redis.del(...keys);
  o = await setupOrg(app);
});

const get = (cookie: string, url: string) => request(app).get(url).set('cookie', cookie);
const dashboard = (cookie = o.viewer) => get(cookie, '/api/dashboard');
const patchStatus = (id: string, version: number, status: string) =>
  request(app)
    .patch(`/api/incidents/${id}/status`)
    .set('cookie', o.engineer)
    .send({ version, status });

describe('getOrSet', () => {
  it('loads once, serves the cached value, and never caches a failed load', async () => {
    const key = `unit:${randomUUID()}`;
    const loader = vi.fn(async () => ({ n: 1 }));
    expect(await getOrSet(key, 30, loader)).toEqual({ n: 1 });
    expect(await getOrSet(key, 30, loader)).toEqual({ n: 1 });
    expect(loader).toHaveBeenCalledTimes(1);

    const failing = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue('ok');
    const k2 = `unit:${randomUUID()}`;
    await expect(getOrSet(k2, 30, failing)).rejects.toThrow('db down');
    expect(await getOrSet(k2, 30, failing)).toBe('ok');
  });

  it('expires after the TTL', async () => {
    const key = `unit:${randomUUID()}`;
    const loader = vi.fn(async () => Date.now());
    await getOrSet(key, 1, loader);
    await sleep(1200);
    await getOrSet(key, 1, loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('invalidate forces the next call to reload', async () => {
    const key = `unit:${randomUUID()}`;
    const loader = vi.fn(async () => 'v');
    await getOrSet(key, 30, loader);
    await invalidate(key);
    await getOrSet(key, 30, loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('falls back to the loader when Redis is unavailable', async () => {
    vi.spyOn(getSharedRedis(), 'get').mockRejectedValue(new Error('redis down'));
    vi.spyOn(getSharedRedis(), 'set').mockRejectedValue(new Error('redis down'));
    expect(await getOrSet(`unit:${randomUUID()}`, 30, async () => 42)).toBe(42);
  });
});

describe('GET /api/dashboard', () => {
  it('reports open and critical incidents, degraded services, recent deployments and resolution time', async () => {
    const a = await createIncident(app, o.engineer, o.serviceId, { title: 'a', severity: 'SEV1' });
    await createIncident(app, o.engineer, o.serviceId, { title: 'b', severity: 'SEV3' });
    const c = await createIncident(app, o.engineer, o.serviceId, { title: 'c', severity: 'SEV1' });
    // c started 90 minutes ago and is resolved now
    await db
      .update(incidents)
      .set({ startedAt: new Date(Date.now() - 90 * 60_000) })
      .where(eq(incidents.id, c.id));
    await patchStatus(c.id, 1, 'INVESTIGATING');
    await patchStatus(c.id, 2, 'RESOLVED');

    await request(app)
      .post('/api/metrics')
      .set('cookie', o.engineer)
      .send({ serviceId: o.serviceId, errorRate: 0.3, latencyMs: 3000, requestsPerMin: 100 });
    await request(app)
      .post('/api/deployments')
      .set('cookie', o.engineer)
      .send({ serviceId: o.serviceId, version: 'v7', commitSha: 'abc1234' });

    const res = await dashboard();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ openIncidents: 2, criticalIncidents: 1 });
    expect(res.body.degradedServices).toEqual([
      { id: o.serviceId, name: 'Payment Service', status: 'DEGRADED' },
    ]);
    expect(res.body.recentDeployments[0]).toMatchObject({
      version: 'v7',
      serviceName: 'Payment Service',
    });
    expect(res.body.avgResolutionMinutes).toBeGreaterThan(89.5);
    expect(res.body.avgResolutionMinutes).toBeLessThan(91);
    void a;
  });

  it('lists recent activity across incidents, newest first, with who did it', async () => {
    const a = await createIncident(app, o.engineer, o.serviceId, { title: 'First incident' });
    const b = await createIncident(app, o.admin, o.serviceId, { title: 'Second incident' });
    await patchStatus(a.id, 1, 'INVESTIGATING');
    const res = await dashboard();
    const activity = res.body.recentActivity as {
      eventType: string;
      incidentTitle: string;
      actorName: string;
      incidentId: string;
    }[];
    expect(activity.map((x) => x.eventType)).toEqual([
      'incident.status_changed',
      'incident.created',
      'incident.created',
    ]);
    expect(activity[0]).toMatchObject({ incidentTitle: 'First incident', incidentId: a.id });
    expect(activity[1]).toMatchObject({ incidentTitle: 'Second incident', incidentId: b.id });
    expect(activity.every((x) => typeof x.actorName === 'string' && x.actorName.length > 0)).toBe(
      true,
    );
  });

  it('caps recent activity at 8 entries and never shows another organization', async () => {
    const other = await setupOrg(app, 'b');
    await createIncident(app, other.engineer, other.serviceId, { title: 'Secret of org B' });
    for (let i = 0; i < 10; i++)
      await createIncident(app, o.engineer, o.serviceId, { title: `Mine ${i}` });
    const activity = (await dashboard()).body.recentActivity as { incidentTitle: string }[];
    expect(activity).toHaveLength(8);
    expect(activity.some((x) => x.incidentTitle.includes('Secret'))).toBe(false);
  });

  it('has null resolution time and zero counts for an empty organization', async () => {
    const res = await dashboard();
    expect(res.body).toMatchObject({
      openIncidents: 0,
      criticalIncidents: 0,
      degradedServices: [],
      recentDeployments: [],
      avgResolutionMinutes: null,
    });
  });

  it('a cache hit does not touch the database for the data (only the auth check queries)', async () => {
    await createIncident(app, o.engineer, o.serviceId);
    const spy = vi.spyOn(pool, 'query');

    const first = await dashboard();
    const firstQueries = spy.mock.calls.length;
    spy.mockClear();
    const second = await dashboard();
    const secondQueries = spy.mock.calls.length;

    expect(first.status).toBe(200);
    expect(firstQueries).toBeGreaterThan(2); // auth + the dashboard queries
    expect(secondQueries).toBe(1); // auth only
    expect(second.body).toEqual(first.body); // identical, including generatedAt
  });

  it('an incident status change invalidates the cache immediately', async () => {
    const inc = await createIncident(app, o.engineer, o.serviceId, { severity: 'SEV1' });
    expect((await dashboard()).body).toMatchObject({ openIncidents: 1, criticalIncidents: 1 });
    const cachedAgain = await dashboard();
    expect(cachedAgain.body.openIncidents).toBe(1);

    await patchStatus(inc.id, 1, 'INVESTIGATING');
    await patchStatus(inc.id, 2, 'RESOLVED');
    const after = await dashboard();
    expect(after.body).toMatchObject({ openIncidents: 0, criticalIncidents: 0 });
    expect(after.body.avgResolutionMinutes).not.toBeNull();
  });

  it('creating an incident, a metrics snapshot, a deployment or a service status change each invalidate it', async () => {
    expect((await dashboard()).body.openIncidents).toBe(0);
    await createIncident(app, o.engineer, o.serviceId);
    expect((await dashboard()).body.openIncidents).toBe(1);

    expect((await dashboard()).body.degradedServices).toHaveLength(0);
    await request(app)
      .post('/api/metrics')
      .set('cookie', o.engineer)
      .send({ serviceId: o.serviceId, errorRate: 0.6, latencyMs: 100, requestsPerMin: 1 });
    expect((await dashboard()).body.degradedServices[0].status).toBe('DOWN');

    expect((await dashboard()).body.recentDeployments).toHaveLength(0);
    await request(app)
      .post('/api/deployments')
      .set('cookie', o.engineer)
      .send({ serviceId: o.serviceId, version: 'v1', commitSha: 'abc1234' });
    expect((await dashboard()).body.recentDeployments).toHaveLength(1);

    await request(app)
      .patch(`/api/services/${o.serviceId}`)
      .set('cookie', o.admin)
      .send({ status: 'HEALTHY' });
    expect((await dashboard()).body.degradedServices).toHaveLength(0);
  });

  it('is scoped per organization (separate cache keys) and one org change does not touch another', async () => {
    const other = await setupOrg(app, 'b');
    await createIncident(app, o.engineer, o.serviceId);
    expect((await dashboard()).body.openIncidents).toBe(1);
    expect((await get(other.owner, '/api/dashboard')).body.openIncidents).toBe(0);
    await createIncident(app, other.engineer, other.serviceId);
    await createIncident(app, other.engineer, other.serviceId);
    expect((await get(other.owner, '/api/dashboard')).body.openIncidents).toBe(2);
    expect((await dashboard()).body.openIncidents).toBe(1);
    expect((await request(app).get('/api/dashboard')).status).toBe(401);
  });
});

describe('GET /api/services/health', () => {
  it('lists every service with its newest snapshot and is invalidated by new metrics', async () => {
    const second = (
      await request(app)
        .post('/api/services')
        .set('cookie', o.admin)
        .send({ projectId: o.projectId, name: 'Auth', slug: 'auth' })
    ).body.service.id;
    const push = (serviceId: string, errorRate: number, capturedAt: string) =>
      request(app)
        .post('/api/metrics')
        .set('cookie', o.engineer)
        .send({ serviceId, errorRate, latencyMs: 100, requestsPerMin: 10, capturedAt });
    await push(o.serviceId, 0.001, '2026-04-01T10:00:00Z');
    await push(o.serviceId, 0.4, '2026-04-01T12:00:00Z');
    await push(o.serviceId, 0.001, '2026-04-01T11:00:00Z');

    const res = await get(o.viewer, '/api/services/health');
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.services.map((s: { name: string }) => [s.name, s]));
    expect(byName['Payment Service'].latestMetric).toMatchObject({
      errorRate: 0.4,
      capturedAt: '2026-04-01T12:00:00.000Z',
    });
    expect(byName['Payment Service'].status).toBe('DEGRADED');
    expect(byName['Auth'].latestMetric).toBeNull();
    expect(byName['Auth'].id).toBe(second);

    await push(second, 0.7, '2026-04-02T00:00:00Z');
    const after = await get(o.viewer, '/api/services/health');
    expect(after.body.services.find((s: { name: string }) => s.name === 'Auth').status).toBe(
      'DOWN',
    );
  });

  it('serves from cache on repeat and never mixes organizations', async () => {
    const other = await setupOrg(app, 'b');
    await get(o.viewer, '/api/services/health');
    const spy = vi.spyOn(pool, 'query');
    await get(o.viewer, '/api/services/health');
    expect(spy.mock.calls.length).toBe(1);
    const theirs = await get(other.viewer, '/api/services/health');
    expect(theirs.body.services.map((s: { id: string }) => s.id)).toEqual([other.serviceId]);
  });
});
