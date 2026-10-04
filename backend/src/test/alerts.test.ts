import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Worker } from 'bullmq';
import request from './request';
import { buildApp } from '../app';
import { db, pool } from '../db/client';
import { auditLogs, incidentEvents, incidents, notifications, users } from '../db/schema';
import { getEventsQueue } from '../events/queues';
import { createEventWorker } from '../workers/eventWorker';
import { closeAll, resetQueues } from './aiHelpers';
import { alertBody, createKey, withKey } from './integrationHelpers';
import { resetDb, setupOrg, sleep, userIdOf, waitFor, type TestOrg } from './helpers';
import { createRealtimeTestHarness } from './realtimeHarness';

const app = buildApp();
const workers: Worker[] = [];
let o: TestOrg;
let key: string;

afterAll(() => pool.end());
beforeEach(async () => {
  await resetQueues();
  await resetDb();
  o = await setupOrg(app);
  key = (await createKey(app, o.admin, { name: 'grafana-alerts' })).key;
});
afterEach(() => closeAll(workers));

const fire = (body: object = alertBody(o), k = key) =>
  withKey(app, k).post('/api/integrations/alerts', body);
const listIncidents = async () =>
  (await request(app).get('/api/incidents').set('cookie', o.viewer)).body;
const eventTypes = async (incidentId: string) =>
  (
    await db
      .select()
      .from(incidentEvents)
      .where(eq(incidentEvents.incidentId, incidentId))
      .orderBy(incidentEvents.createdAt)
  ).map((e) => e.eventType);

describe('a firing alert opens an incident', () => {
  it('creates it from the alert, attributes it to the key, and marks it automated', async () => {
    const res = await fire(
      alertBody(o, {
        description: 'Error rate is 34% for 5 minutes',
        fingerprint: 'checkout-error-rate',
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ action: 'created', fingerprint: 'checkout-error-rate' });

    const detail = (
      await request(app).get(`/api/incidents/${res.body.incidentId}`).set('cookie', o.viewer)
    ).body;
    expect(detail.incident).toMatchObject({
      title: 'High error rate on checkout',
      severity: 'SEV1', // "critical" maps to SEV1
      status: 'OPEN',
      source: 'webhook',
      serviceName: 'Payment Service',
    });
    expect(detail.incident.description).toContain('Error rate is 34%');
    expect(detail.incident.description).toContain('Raised automatically by webhook');
    expect(detail.events[0]).toMatchObject({
      eventType: 'incident.created',
      actor: { name: 'grafana-alerts' },
    });
    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, res.body.incidentId));
    expect(audit).toMatchObject({ action: 'incident.created' });
    expect((await listIncidents()).items[0].source).toBe('webhook');
  });

  it.each([
    ['critical', 'SEV1'],
    ['page', 'SEV1'],
    ['high', 'SEV2'],
    ['error', 'SEV2'],
    ['warning', 'SEV3'],
    ['low', 'SEV4'],
    ['info', 'SEV4'],
    ['sev2', 'SEV2'],
    ['SEV3', 'SEV3'],
    ['P1', 'SEV1'],
    [undefined, 'SEV3'],
  ])('maps severity %s to %s', async (severity, expected) => {
    const res = await fire(alertBody(o, { severity, fingerprint: `fp-${String(severity)}` }));
    const incident = (
      await request(app).get(`/api/incidents/${res.body.incidentId}`).set('cookie', o.viewer)
    ).body.incident;
    expect(incident.severity).toBe(expected);
  });

  it.each([
    ['SEV1', 'URGENT'],
    ['SEV2', 'HIGH'],
    ['SEV3', 'MEDIUM'],
    ['SEV4', 'LOW'],
  ])('%s alerts get %s priority', async (severity, priority) => {
    const res = await fire(alertBody(o, { severity, fingerprint: `prio-${severity}` }));
    const incident = (
      await request(app).get(`/api/incidents/${res.body.incidentId}`).set('cookie', o.viewer)
    ).body.incident;
    expect(incident.priority).toBe(priority);
  });

  it('rejects an unknown severity, a missing title, and a bad source label with a clear 400', async () => {
    const bad = await fire(alertBody(o, { severity: 'banana' }));
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body.error.details)).toContain('Unknown severity');
    expect((await fire({ service: 'payment' })).status).toBe(400);
    expect((await fire(alertBody(o, { source: 'has spaces!' }))).status).toBe(400);
    expect((await fire(alertBody(o, { title: 'x'.repeat(201) }))).status).toBe(400);
    expect((await listIncidents()).total).toBe(0);
  });

  it('is rejected without a key, and for an unknown or missing service', async () => {
    expect((await request(app).post('/api/integrations/alerts').send(alertBody(o))).status).toBe(
      401,
    );
    const unknown = await fire(alertBody(o, { service: 'no-such-service' }));
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('UNKNOWN_SERVICE');
    const missing = await fire({ title: 'No service given' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('SERVICE_REQUIRED');
  });

  it('a key tied to a service can omit it, and cannot raise alerts for another', async () => {
    const second = (
      await request(app)
        .post('/api/services')
        .set('cookie', o.admin)
        .send({ projectId: o.projectId, name: 'Auth', slug: 'auth' })
    ).body.service.id;
    const bound = (await createKey(app, o.admin, { scopes: ['alerts'], serviceId: o.serviceId }))
      .key;
    expect((await fire({ title: 'Bound alert' }, bound)).status).toBe(201);
    const other = await fire({ title: 'Wrong service', service: 'auth' }, bound);
    expect(other.status).toBe(403);
    expect(other.body.error.code).toBe('KEY_SERVICE_MISMATCH');
    expect((await fire({ title: 'By id', serviceId: second }, bound)).status).toBe(403);
  });
});

describe('the same problem does not open duplicates', () => {
  it('a repeated alert attaches to the open incident instead of creating another', async () => {
    const first = await fire(alertBody(o, { fingerprint: 'same' }));
    const again = await fire(alertBody(o, { fingerprint: 'same' }));
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ action: 'attached', incidentId: first.body.incidentId });
    expect((await listIncidents()).total).toBe(1);
    expect(await eventTypes(first.body.incidentId)).toContain('incident.alert_repeated');
  });

  it('without a fingerprint, the same service and title count as the same alert; a different title does not', async () => {
    const a = await fire(alertBody(o));
    const b = await fire(alertBody(o));
    const c = await fire(alertBody(o, { title: 'Latency is high' }));
    expect(b.body).toMatchObject({ action: 'attached', incidentId: a.body.incidentId });
    expect(c.body.action).toBe('created');
    expect(c.body.incidentId).not.toBe(a.body.incidentId);
    expect((await listIncidents()).total).toBe(2);
  });

  it('six identical alerts arriving at the same moment open exactly one incident', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => fire(alertBody(o, { fingerprint: 'stampede' }))),
    );
    expect(results.every((r) => [200, 201].includes(r.status))).toBe(true);
    expect(results.filter((r) => r.body.action === 'created')).toHaveLength(1);
    expect(results.filter((r) => r.body.action === 'attached')).toHaveLength(5);
    expect(new Set(results.map((r) => r.body.incidentId)).size).toBe(1);
    expect(await db.select().from(incidents)).toHaveLength(1);
  });

  it('a flapping alert adds at most one "fired again" entry per minute', async () => {
    const first = await fire(alertBody(o, { fingerprint: 'flap' }));
    for (let i = 0; i < 5; i++) await fire(alertBody(o, { fingerprint: 'flap' }));
    const repeats = async () =>
      (await eventTypes(first.body.incidentId)).filter((e) => e === 'incident.alert_repeated')
        .length;
    expect(await repeats()).toBe(1);
    // a minute later it is worth noting again
    await db
      .update(incidentEvents)
      .set({ createdAt: new Date(Date.now() - 2 * 60_000) })
      .where(eq(incidentEvents.eventType, 'incident.alert_repeated'));
    await fire(alertBody(o, { fingerprint: 'flap' }));
    expect(await repeats()).toBe(2);
  });

  it('once the incident is resolved, the same alert firing again opens a NEW incident', async () => {
    const first = await fire(alertBody(o, { fingerprint: 'recurs' }));
    const id = first.body.incidentId as string;
    const patch = (status: string, version: number) =>
      request(app)
        .patch(`/api/incidents/${id}/status`)
        .set('cookie', o.engineer)
        .send({ version, status });
    await patch('INVESTIGATING', 1);
    await patch('RESOLVED', 2);
    const again = await fire(alertBody(o, { fingerprint: 'recurs' }));
    expect(again.body.action).toBe('created');
    expect(again.body.incidentId).not.toBe(id);
    expect((await listIncidents()).total).toBe(2);
  });
});

describe('resolved alerts', () => {
  it('leave a note on the open incident but never close it: that stays a human decision', async () => {
    const first = await fire(alertBody(o, { fingerprint: 'r1' }));
    const resolved = await fire(alertBody(o, { fingerprint: 'r1', status: 'resolved' }));
    expect(resolved.status).toBe(200);
    expect(resolved.body).toMatchObject({ action: 'noted', incidentId: first.body.incidentId });
    expect(await eventTypes(first.body.incidentId)).toContain('incident.alert_resolved');
    const incident = (
      await request(app).get(`/api/incidents/${first.body.incidentId}`).set('cookie', o.viewer)
    ).body.incident;
    expect(incident.status).toBe('OPEN');
  });

  it('are ignored when nothing is open, and never create an incident', async () => {
    const res = await fire(alertBody(o, { fingerprint: 'never-fired', status: 'resolved' }));
    expect(res.body).toMatchObject({ action: 'ignored', incidentId: null });
    expect((await listIncidents()).total).toBe(0);
  });
});

describe('recent deployments are linked automatically', () => {
  const deploy = (version: string, minutesAgo: number) =>
    request(app)
      .post('/api/deployments')
      .set('cookie', o.engineer)
      .send({
        service: 'payment',
        version,
        commitSha: 'abc1234',
        deployedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      });

  it('links deployments from the last hour, and ignores older ones', async () => {
    await deploy('v2.4.0', 12);
    await deploy('v2.3.9', 40);
    await deploy('v2.0.0', 300);
    const res = await fire(alertBody(o));
    const list = (
      await request(app)
        .get(`/api/incidents/${res.body.incidentId}/deployments?windowHours=24`)
        .set('cookie', o.viewer)
    ).body.deployments;
    const linked = list
      .filter((d: { linked: boolean }) => d.linked)
      .map((d: { version: string }) => d.version)
      .sort();
    expect(linked).toEqual(['v2.3.9', 'v2.4.0']);
    expect(await eventTypes(res.body.incidentId)).toEqual(
      expect.arrayContaining(['incident.created', 'incident.deployment_linked']),
    );
  });

  it('links at most the three most recent', async () => {
    for (let i = 0; i < 5; i++) await deploy(`v1.${i}`, 5 + i * 5);
    const res = await fire(alertBody(o));
    const detail = (
      await request(app).get(`/api/incidents/${res.body.incidentId}`).set('cookie', o.viewer)
    ).body;
    expect(
      detail.events.filter(
        (e: { eventType: string }) => e.eventType === 'incident.deployment_linked',
      ),
    ).toHaveLength(3);
  });

  it('does not link anything again when an alert merely repeats', async () => {
    await deploy('v3.0.0', 5);
    const first = await fire(alertBody(o, { fingerprint: 'link-once' }));
    await fire(alertBody(o, { fingerprint: 'link-once' }));
    expect(
      (await eventTypes(first.body.incidentId)).filter((e) => e === 'incident.deployment_linked'),
    ).toHaveLength(1);
  });
});

describe('Alertmanager and Grafana webhooks', () => {
  const am = (payload: object, qs = '', k = key) =>
    withKey(app, k).post(`/api/integrations/alertmanager${qs}`, payload);
  const payload = (over: Record<string, unknown> = {}) => ({
    status: 'firing',
    alerts: [
      {
        status: 'firing',
        labels: {
          alertname: 'HighErrorRate',
          service: 'payment',
          severity: 'critical',
          instance: 'pod-1',
        },
        annotations: {
          summary: 'Error rate above 5% on payment',
          description: 'Sustained 5xx responses',
        },
        ...over,
      },
    ],
  });

  it('opens an incident from the standard payload, using the summary, labels and severity', async () => {
    const res = await am(payload());
    expect(res.status).toBe(201);
    const { results } = res.body;
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe('created');
    const incident = (
      await request(app).get(`/api/incidents/${results[0].incidentId}`).set('cookie', o.viewer)
    ).body.incident;
    expect(incident).toMatchObject({
      title: 'Error rate above 5% on payment',
      severity: 'SEV1',
      source: 'alertmanager',
      serviceName: 'Payment Service',
    });
    expect(incident.description).toContain('Sustained 5xx responses');
    expect(incident.description).toContain('instance=pod-1');
  });

  it('derives a stable fingerprint from the labels, so the same alert sent again attaches', async () => {
    const first = await am(payload());
    const second = await am(payload());
    expect(second.status).toBe(200);
    expect(second.body.results[0]).toMatchObject({
      action: 'attached',
      incidentId: first.body.results[0].incidentId,
      fingerprint: first.body.results[0].fingerprint,
    });
    const other = await am(
      payload({ labels: { alertname: 'DiskFull', service: 'payment', severity: 'warning' } }),
    );
    expect(other.body.results[0].action).toBe('created');
    expect((await listIncidents()).total).toBe(2);
  });

  it('handles several alerts in one request, and firing then resolved', async () => {
    const batch = {
      alerts: [
        {
          status: 'firing',
          labels: { alertname: 'A', service: 'payment', severity: 'high' },
          annotations: { summary: 'A is down' },
        },
        {
          status: 'firing',
          labels: { alertname: 'B', service: 'payment', severity: 'low' },
          annotations: { summary: 'B is slow' },
        },
      ],
    };
    const res = await am(batch);
    expect(res.body.results.map((r: { action: string }) => r.action)).toEqual([
      'created',
      'created',
    ]);
    const resolved = await am({ alerts: [{ ...batch.alerts[0], status: 'resolved' }] });
    expect(resolved.status).toBe(200);
    expect(resolved.body.results[0]).toMatchObject({
      action: 'noted',
      incidentId: res.body.results[0].incidentId,
    });
  });

  it('labels the source (for example grafana), and uses the "job" label when there is no service label', async () => {
    const res = await am(
      {
        alerts: [
          {
            status: 'firing',
            labels: { alertname: 'X', job: 'payment' },
            annotations: { summary: 'From Grafana' },
          },
        ],
      },
      '?source=grafana',
    );
    const incident = (
      await request(app)
        .get(`/api/incidents/${res.body.results[0].incidentId}`)
        .set('cookie', o.viewer)
    ).body.incident;
    expect(incident.source).toBe('grafana');
  });

  it('falls back to the key service, and explains when no service can be determined', async () => {
    const noService = {
      alerts: [
        {
          status: 'firing',
          labels: { alertname: 'Orphan' },
          annotations: { summary: 'No service label' },
        },
      ],
    };
    const unbound = await am(noService);
    expect(unbound.status).toBe(400);
    expect(unbound.body.error.code).toBe('SERVICE_REQUIRED');
    const bound = (await createKey(app, o.admin, { scopes: ['alerts'], serviceId: o.serviceId }))
      .key;
    expect((await am(noService, '', bound)).status).toBe(201);
  });

  it('rejects malformed payloads', async () => {
    expect((await am({ alerts: [] })).status).toBe(400);
    expect((await am({})).status).toBe(400);
    expect((await am({ alerts: [{ status: 'weird', labels: {}, annotations: {} }] })).status).toBe(
      400,
    );
  });
});

describe('limits and the rest of the pipeline', () => {
  it('opening incidents automatically is capped per organization (30 an hour)', async () => {
    const results = [];
    for (let i = 0; i < 31; i++)
      results.push(
        await fire(alertBody(o, { title: `Distinct alert ${i}`, fingerprint: `storm-${i}` })),
      );
    expect(results.slice(0, 30).every((r) => r.status === 201)).toBe(true);
    expect(results[30]!.status).toBe(429);
    expect(results[30]!.body.error.code).toBe('AUTO_INCIDENT_LIMIT');
    // repeats of an already-open alert are still accepted
    expect(
      (await fire(alertBody(o, { title: 'Distinct alert 0', fingerprint: 'storm-0' }))).status,
    ).toBe(200);
  }, 60_000);

  it('each key is limited to 120 alerts a minute, enforced atomically', async () => {
    await fire(alertBody(o, { fingerprint: 'busy' }));
    const results = await Promise.all(
      Array.from({ length: 124 }, () => fire(alertBody(o, { fingerprint: 'busy' }))),
    );
    expect(results.filter((r) => r.status === 429).length).toBe(5); // 1 earlier + 124 = 125 requests, 120 allowed
    expect(results.filter((r) => r.status === 200).length).toBe(119);
    const other = (await createKey(app, o.admin)).key;
    expect((await fire(alertBody(o, { fingerprint: 'busy' }), other)).status).toBe(200); // another key has its own budget
  }, 60_000);

  it('rejects oversized payloads', async () => {
    const res = await fire(alertBody(o, { description: 'x'.repeat(150 * 1024) }));
    expect(res.status).toBe(413);
  });

  it('notifies the team like any incident, but never the key service account', async () => {
    const worker = createEventWorker();
    workers.push(worker);
    await worker.waitUntilReady();
    const res = await fire(alertBody(o));
    const ownerId = await userIdOf(app, o.owner);
    const adminId = await userIdOf(app, o.admin);
    const rows = await waitFor(async () => {
      const r = await db.select().from(notifications);
      return r.length >= 2 ? r : null;
    });
    expect(rows.map((r) => r.userId).sort()).toEqual([adminId, ownerId].sort());
    expect(rows[0]!.payload.message).toBe('New SEV1 incident: High error rate on checkout');
    expect(rows[0]!.payload.incidentId).toBe(res.body.incidentId);

    // resolving and closing later still never notifies the bot that created it
    const id = res.body.incidentId as string;
    await request(app)
      .patch(`/api/incidents/${id}/status`)
      .set('cookie', o.engineer)
      .send({ version: 1, status: 'INVESTIGATING' });
    await request(app)
      .patch(`/api/incidents/${id}/status`)
      .set('cookie', o.engineer)
      .send({ version: 2, status: 'RESOLVED' });
    await waitFor(async () => (await getEventsQueue().getCompletedCount()) >= 3);
    await sleep(150);
    const bots = await db.select({ id: users.id }).from(users).where(eq(users.isBot, true));
    const all = await db.select().from(notifications);
    expect(all.some((n) => bots.some((b) => b.id === n.userId))).toBe(false);
  });

  it('shows up live: a watching colleague receives it over the socket the moment the alert arrives', async () => {
    const h = await createRealtimeTestHarness();
    try {
      const watcher = await h.connect(o.viewer);
      const got = h.next<{ incident: { title: string; source: string } }>(
        watcher,
        'incident.created',
      );
      const res = await withKey(h.app, key).post('/api/integrations/alerts', alertBody(o));
      expect(res.status).toBe(201);
      const evt = await got;
      expect(evt.incident).toMatchObject({
        title: 'High error rate on checkout',
        source: 'webhook',
      });
    } finally {
      await h.close();
    }
  });

  it('a revoked key can no longer raise alerts', async () => {
    const created = await createKey(app, o.admin, { name: 'to-revoke' });
    expect((await fire(alertBody(o), created.key)).status).toBe(201);
    await request(app).delete(`/api/api-keys/${created.id}`).set('cookie', o.admin);
    const after = await fire(
      alertBody(o, { title: 'After revoke', fingerprint: 'x' }),
      created.key,
    );
    expect(after.status).toBe(401);
    expect((await listIncidents()).total).toBe(1);
  });
});
