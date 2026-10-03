import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from './request';
import { buildApp } from '../app';
import { pool } from '../db/client';
import { deriveHealth } from '../modules/metrics/service';
import { resetDb, setupOrg, type TestOrg } from './helpers';

const app = buildApp();
let o: TestOrg;

afterAll(() => pool.end());
beforeEach(async () => {
  await resetDb();
  o = await setupOrg(app);
});

const ingest = (cookie: string, over: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/metrics')
    .set('cookie', cookie)
    .send({
      serviceId: o.serviceId,
      errorRate: 0.01,
      latencyMs: 120,
      requestsPerMin: 500,
      ...over,
    });
const latest = (cookie: string, id = o.serviceId) =>
  request(app).get(`/api/services/${id}/metrics/latest`).set('cookie', cookie);
const serviceStatus = async () =>
  (await request(app).get('/api/services').set('cookie', o.owner)).body.items.find(
    (s: { id: string }) => s.id === o.serviceId,
  ).status;

describe('health derivation', () => {
  it.each([
    [0.001, 100, 'HEALTHY'],
    [0.06, 100, 'DEGRADED'],
    [0.01, 1500, 'DEGRADED'],
    [0.5, 100, 'DOWN'],
  ])('error %s latency %s => %s', (e, l, expected) => expect(deriveHealth(e, l)).toBe(expected));
});

describe('metrics', () => {
  it('stores a snapshot, derives health, and mirrors it onto the service', async () => {
    expect(await serviceStatus()).toBe('UNKNOWN');
    const res = await ingest(o.engineer, { errorRate: 0.3, latencyMs: 4000 });
    expect(res.status).toBe(201);
    expect(res.body.metric.healthStatus).toBe('DEGRADED');
    expect(await serviceStatus()).toBe('DEGRADED');
    expect((await ingest(o.engineer, { healthStatus: 'DOWN' })).body.metric.healthStatus).toBe(
      'DOWN',
    );
    expect(await serviceStatus()).toBe('DOWN');
  });

  it('latest returns the newest by capturedAt, and an older late arrival does not change service status', async () => {
    await ingest(o.engineer, { errorRate: 0.4, capturedAt: '2026-03-01T12:00:00Z' });
    await ingest(o.engineer, { errorRate: 0.001, capturedAt: '2026-03-01T10:00:00Z' }); // older, arrives later
    const res = await latest(o.viewer);
    expect(res.body.metric).toMatchObject({
      errorRate: 0.4,
      capturedAt: '2026-03-01T12:00:00.000Z',
    });
    expect(await serviceStatus()).toBe('DEGRADED');
  });

  it('returns null when a service has no snapshots', async () => {
    expect((await latest(o.viewer)).body).toEqual({ metric: null });
  });

  it('validates input, permissions and tenancy', async () => {
    expect((await ingest(o.engineer, { errorRate: 1.5 })).status).toBe(400);
    expect((await ingest(o.engineer, { latencyMs: -1 })).status).toBe(400);
    expect((await ingest(o.viewer)).status).toBe(403);
    const other = await setupOrg(app, 'b');
    expect((await ingest(o.engineer, { serviceId: other.serviceId })).status).toBe(404);
    expect((await latest(o.owner, other.serviceId)).status).toBe(404);
  });
});
