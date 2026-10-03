import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import request from './request';
import { eq } from 'drizzle-orm';
import type { Worker } from 'bullmq';
import type { AppEvent } from '@opsflow/shared';
import { buildApp } from '../app';
import { db, pool } from '../db/client';
import { idempotencyKeys, notifications } from '../db/schema';
import { getEventsQueue } from '../events/queues';
import { buildEvent, getPublishFailureCount, publishEvent } from '../events/publisher';
import { createEventWorker, type EventHandler } from '../workers/eventWorker';
import {
  createIncident,
  resetDb,
  setupOrg,
  sleep,
  userIdOf,
  waitFor,
  type TestOrg,
} from './helpers';

const app = buildApp();
const queue = getEventsQueue();

type LogLine = Record<string, unknown>;
const lines: LogLine[] = [];
const testLog = pino({ level: 'info' }, { write: (s: string) => void lines.push(JSON.parse(s)) });

let worker: Worker<AppEvent> | undefined;
let o: TestOrg;

async function startWorker(handler?: EventHandler) {
  worker = createEventWorker({ handler, log: testLog });
  await worker.waitUntilReady();
}
const allNotifications = () => db.select().from(notifications);
const as = (cookie: string) => ({
  get: (url: string) => request(app).get(url).set('cookie', cookie),
  patch: (url: string, body: object = {}) =>
    request(app).patch(url).set('cookie', cookie).send(body),
});

beforeEach(async () => {
  await queue.obliterate({ force: true });
  await resetDb();
  lines.length = 0;
  vi.restoreAllMocks();
  o = await setupOrg(app);
});
afterEach(async () => {
  await worker?.close();
  worker = undefined;
});
afterAll(() => pool.end());

async function sampleEvent(over: Partial<{ actorId: string; assigneeId: string | null }> = {}) {
  const me = await as(o.owner).get('/api/auth/me');
  const orgId = me.body.organization.id as string;
  const ownerId = me.body.user.id as string;
  const engineerId = await userIdOf(app, o.engineer);
  return buildEvent(
    {
      type: 'incident.created',
      payload: {
        incidentId: randomUUID(),
        title: 'Sample',
        severity: 'SEV2',
        serviceId: o.serviceId,
        actorId: over.actorId ?? ownerId,
        assigneeId: over.assigneeId === undefined ? engineerId : over.assigneeId,
        createdBy: ownerId,
      },
    },
    { organizationId: orgId, requestId: 'req-sample' },
  );
}

describe('idempotent delivery', () => {
  it('the same eventId delivered three times creates notifications exactly once', async () => {
    const event = await sampleEvent();
    for (let i = 0; i < 3; i++) await queue.add(event.type, event, { jobId: `dup-${i}` }); // distinct jobs, same eventId
    await startWorker();
    await waitFor(async () => (await queue.getCompletedCount()) === 3);

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.eventId));
    expect(rows).toHaveLength(2); // assignee + the other admin; the actor (owner) is excluded
    expect(await db.select().from(idempotencyKeys)).toHaveLength(1);
  });

  it('jobId = eventId stops duplicate enqueues of the same event', async () => {
    const event = await sampleEvent();
    await publishEvent(event);
    await publishEvent(event);
    expect(await queue.getWaitingCount()).toBe(1);
  });
});

describe('retries', () => {
  it('a job that throws twice then succeeds ends COMPLETED on the third attempt', async () => {
    let calls = 0;
    await startWorker(async () => {
      calls += 1;
      if (calls < 3) throw new Error('flaky');
    });
    const event = await sampleEvent();
    await publishEvent(event);
    await waitFor(async () => (await queue.getCompletedCount()) === 1);

    expect(calls).toBe(3);
    expect(await queue.getFailedCount()).toBe(0);
    const job = await queue.getJob(event.eventId);
    expect(await job!.getState()).toBe('completed');
    const failed = lines.filter((l) => l.msg === 'job failed');
    expect(failed.map((l) => l.attempt)).toEqual([1, 2]);
    expect(failed.every((l) => l.will_retry === true)).toBe(true);
    expect(lines.find((l) => l.msg === 'job succeeded')).toMatchObject({ attempt: 3 });
  });

  it('a job that always throws lands in the failed set after exactly 3 attempts', async () => {
    let calls = 0;
    await startWorker(async () => {
      calls += 1;
      throw new Error('always broken');
    });
    const event = await sampleEvent();
    await publishEvent(event);
    await waitFor(async () => (await queue.getFailedCount()) === 1);
    await sleep(300); // a wrongly retried job would show up as a 4th call by now

    expect(calls).toBe(3);
    const [job] = await queue.getFailed();
    expect(job).toMatchObject({ attemptsMade: 3, failedReason: 'always broken' });
    expect(job!.data.eventId).toBe(event.eventId);
    expect(lines.filter((l) => l.msg === 'job failed').at(-1)).toMatchObject({
      attempt: 3,
      will_retry: false,
    });
  });

  it('an invalid payload fails once without retries', async () => {
    let calls = 0;
    await startWorker(async () => {
      calls += 1;
    });
    await queue.add('bogus', { not: 'an event' } as unknown as AppEvent, { jobId: 'bad-1' });
    await waitFor(async () => (await queue.getFailedCount()) === 1);
    await sleep(200);
    const [job] = await queue.getFailed();
    expect(calls).toBe(0);
    expect(job!.attemptsMade).toBe(1);
    expect(job!.failedReason).toMatch(/invalid event payload/);
  });
});

describe('end to end: API -> event -> worker -> notification', () => {
  it('creating an incident notifies the assignee and the other admins, and carries the requestId', async () => {
    await startWorker();
    const engineerId = await userIdOf(app, o.engineer);
    const adminId = await userIdOf(app, o.admin);
    const ownerId = await userIdOf(app, o.owner);
    const viewerId = await userIdOf(app, o.viewer);

    const res = await request(app)
      .post('/api/incidents')
      .set('cookie', o.admin)
      .set('x-request-id', 'req-abc-123')
      .send({
        serviceId: o.serviceId,
        title: 'Checkout 500s',
        severity: 'SEV1',
        assigneeId: engineerId,
      });
    expect(res.status).toBe(201);

    const rows = await waitFor(async () => {
      const r = await allNotifications();
      return r.length >= 2 ? r : null;
    });
    expect(rows.map((r) => r.userId).sort()).toEqual([engineerId, ownerId].sort());
    expect(rows.some((r) => r.userId === adminId || r.userId === viewerId)).toBe(false); // actor and viewer excluded
    expect(rows[0]!.metadata).toMatchObject({
      requestId: 'req-abc-123',
      eventType: 'incident.created',
    });
    expect(rows[0]!.payload.message).toBe('New SEV1 incident: Checkout 500s');

    await waitFor(() => lines.some((l) => l.msg === 'job succeeded'));
    for (const msg of ['job started', 'job succeeded']) {
      expect(lines.find((l) => l.msg === msg)).toMatchObject({
        request_id: 'req-abc-123',
        event_type: 'incident.created',
        attempt: 1,
        job_id: expect.any(String),
        event_id: expect.any(String),
      });
    }
    expect(lines.find((l) => l.msg === 'job succeeded')!.duration_ms).toEqual(expect.any(Number));
  });

  it('events published while no worker runs are still delivered once the worker starts', async () => {
    const engineerId = await userIdOf(app, o.engineer);
    await request(app).post('/api/incidents').set('cookie', o.admin).send({
      serviceId: o.serviceId,
      title: 'While worker is down',
      severity: 'SEV2',
      assigneeId: engineerId,
    });
    await createIncident(app, o.admin, o.serviceId, { title: 'Second one' });

    await sleep(200);
    expect(await allNotifications()).toHaveLength(0);
    expect(await queue.getWaitingCount()).toBe(2);

    await startWorker();
    await waitFor(async () => (await queue.getCompletedCount()) === 2);
    const rows = await allNotifications();
    expect(new Set(rows.map((r) => r.eventId)).size).toBe(2); // one event each, none lost, none doubled
  });

  it('status change and resolve notify the assignee; the actor is left out', async () => {
    await startWorker();
    const engineerId = await userIdOf(app, o.engineer);
    const inc = await createIncident(app, o.admin, o.serviceId, { assigneeId: engineerId });
    await waitFor(async () => (await queue.getCompletedCount()) === 1);

    await as(o.admin).patch(`/api/incidents/${inc.id}/status`, {
      version: 1,
      status: 'INVESTIGATING',
    });
    await as(o.admin).patch(`/api/incidents/${inc.id}/status`, { version: 2, status: 'RESOLVED' });
    await waitFor(async () => (await queue.getCompletedCount()) === 3);

    const mine = (await allNotifications())
      .filter((n) => n.userId === engineerId)
      .map((n) => n.type)
      .sort();
    expect(mine).toEqual(['incident.created', 'incident.resolved', 'incident.status_changed']);
  });

  it("never notifies another organization's users", async () => {
    const other = await setupOrg(app, 'b');
    await startWorker();
    await createIncident(app, o.admin, o.serviceId);
    await waitFor(async () => (await queue.getCompletedCount()) === 1);
    const otherIds = await Promise.all(
      [other.owner, other.admin, other.engineer].map((c) => userIdOf(app, c)),
    );
    expect((await allNotifications()).some((n) => otherIds.includes(n.userId))).toBe(false);
  });

  it('a Redis publish failure does not fail the API request; it is counted', async () => {
    const before = getPublishFailureCount();
    vi.spyOn(queue, 'add').mockRejectedValueOnce(new Error('redis down'));
    const res = await request(app)
      .post('/api/incidents')
      .set('cookie', o.engineer)
      .send({ serviceId: o.serviceId, title: 'Still saved', severity: 'SEV3' });
    expect(res.status).toBe(201);
    expect((await as(o.engineer).get(`/api/incidents/${res.body.incident.id}`)).status).toBe(200);
    expect(getPublishFailureCount()).toBe(before + 1);
  });
});

describe('notifications API', () => {
  it('lists only my notifications, counts unread, and marks them read', async () => {
    await startWorker();
    const engineerId = await userIdOf(app, o.engineer);
    await createIncident(app, o.admin, o.serviceId, { assigneeId: engineerId });
    await waitFor(async () => (await queue.getCompletedCount()) === 1);

    const list = await as(o.engineer).get('/api/notifications');
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ page: 1, total: 1, unreadCount: 1 });
    const [n] = list.body.items;
    expect(n).toMatchObject({
      type: 'incident.created',
      readAt: null,
      incidentId: expect.any(String),
    });

    expect((await as(o.viewer).get('/api/notifications')).body.total).toBe(0);
    expect((await as(o.viewer).patch(`/api/notifications/${n.id}/read`)).status).toBe(404); // not theirs

    const read = await as(o.engineer).patch(`/api/notifications/${n.id}/read`);
    expect(read.status).toBe(200);
    expect(read.body.notification.readAt).not.toBeNull();
    const after = await as(o.engineer).get('/api/notifications');
    expect(after.body.unreadCount).toBe(0);
    expect((await as(o.engineer).get('/api/notifications?unread=true')).body.total).toBe(0);
    // marking again is harmless
    expect((await as(o.engineer).patch(`/api/notifications/${n.id}/read`)).status).toBe(200);
  });

  it('requires auth and validates ids', async () => {
    expect((await request(app).get('/api/notifications')).status).toBe(401);
    expect((await as(o.engineer).patch('/api/notifications/not-a-uuid/read')).status).toBe(400);
  });
});

describe('failed jobs endpoint', () => {
  it('ADMIN+ sees only their own organization failed jobs; others are forbidden', async () => {
    const other = await setupOrg(app, 'b');
    await startWorker(async () => {
      throw new Error('handler exploded');
    });
    await request(app)
      .post('/api/incidents')
      .set('cookie', o.engineer)
      .set('x-request-id', 'req-fail-1')
      .send({ serviceId: o.serviceId, title: 'Will fail downstream', severity: 'SEV2' });
    await waitFor(async () => (await queue.getFailedCount()) === 1);

    const mine = await as(o.admin).get('/api/admin/jobs/failed');
    expect(mine.status).toBe(200);
    expect(mine.body.failed).toHaveLength(1);
    expect(mine.body.failed[0]).toMatchObject({
      type: 'incident.created',
      requestId: 'req-fail-1',
      attemptsMade: 3,
      failedReason: 'handler exploded',
    });
    expect(typeof mine.body.publishFailures).toBe('number');

    expect((await as(other.admin).get('/api/admin/jobs/failed')).body.failed).toEqual([]);
    expect((await as(o.engineer).get('/api/admin/jobs/failed')).status).toBe(403);
    expect((await request(app).get('/api/admin/jobs/failed')).status).toBe(401);
  });
});
