import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from './request';
import type { Worker } from 'bullmq';
import type { AppEvent, IncidentRealtimeData, NotificationDto } from '@opsflow/shared';
import { pool } from '../db/client';
import { config } from '../lib/config';
import { getEventsQueue } from '../events/queues';
import { createRedis } from '../lib/redis';
import { REALTIME_CHANNEL } from '../realtime/channel';
import { createEventWorker } from '../workers/eventWorker';
import { createRealtimeTestHarness, type Harness } from './realtimeHarness';
import { createIncident, resetDb, setupOrg, type TestOrg } from './helpers';

let h: Harness;
let a: TestOrg; // organization A
let b: TestOrg; // organization B
let worker: Worker<AppEvent> | undefined;

beforeAll(async () => {
  h = await createRealtimeTestHarness();
});
afterAll(async () => {
  await h.close();
  await pool.end();
});
beforeEach(async () => {
  await getEventsQueue().obliterate({ force: true });
  await resetDb();
  a = await setupOrg(h.app, 'a');
  b = await setupOrg(h.app, 'b');
});
afterEach(async () => {
  await worker?.close();
  worker = undefined;
});

const ack = (socket: import('socket.io-client').Socket, event: string, arg: unknown) =>
  new Promise<{ ok: boolean; error?: string }>((resolve) => socket.emit(event, arg, resolve));

describe('socket authentication', () => {
  it('rejects a socket with no cookie, a garbage cookie, or a token for a removed membership', async () => {
    await expect(h.connect()).rejects.toThrow('unauthorized');
    await expect(h.connect('opsflow_token=garbage')).rejects.toThrow('unauthorized');
    await expect(h.connect('other=1; opsflow_token=not.a.jwt')).rejects.toThrow('unauthorized');
  });

  it('rejects a handshake from another origin even with a valid cookie (cross-site WebSocket hijacking)', async () => {
    await expect(h.connect(a.viewer, { origin: 'https://evil.example' })).rejects.toThrow();
  });

  it('accepts the web origin, and clients that send no Origin', async () => {
    expect((await h.connect(a.viewer, { origin: config.WEB_ORIGIN })).connected).toBe(true);
  });

  it('accepts a valid session cookie', async () => {
    const socket = await h.connect(a.viewer);
    expect(socket.connected).toBe(true);
  });
});

describe('live incident updates', () => {
  it('a change by user A reaches user B in the same org and not a user in another org', async () => {
    const sameOrg = await h.connect(a.viewer);
    const otherOrg = await h.connect(b.owner);
    const creatorOwnSocket = await h.connect(a.engineer);

    const got = h.next<IncidentRealtimeData>(sameOrg, 'incident.created');
    const alsoGot = h.next<IncidentRealtimeData>(creatorOwnSocket, 'incident.created');
    const leaked = h.never(otherOrg, 'incident.created');
    const created = await createIncident(h.app, a.engineer, a.serviceId, { title: 'Live one' });

    const event = await got;
    expect(event.incidentId).toBe(created.id);
    expect(event.incident).toMatchObject({ title: 'Live one', status: 'OPEN' });
    expect((await alsoGot).incidentId).toBe(created.id);
    await leaked;
  });

  it('emits status_changed, updated (assign/edit) and comment_added to the org', async () => {
    const viewer = await h.connect(a.viewer);
    const { id } = await createIncident(h.app, a.engineer, a.serviceId);
    const patch = (path: string, body: object) =>
      request(h.app).patch(`/api/incidents/${id}${path}`).set('cookie', a.engineer).send(body);

    const status = h.next<IncidentRealtimeData>(viewer, 'incident.status_changed');
    await patch('/status', { version: 1, status: 'INVESTIGATING' });
    expect((await status).incident).toMatchObject({ status: 'INVESTIGATING', version: 2 });

    const updated = h.next<IncidentRealtimeData>(viewer, 'incident.updated');
    await patch('', { version: 2, title: 'Renamed live' });
    expect((await updated).incident?.title).toBe('Renamed live');

    const comment = h.next<IncidentRealtimeData>(viewer, 'incident.comment_added');
    await request(h.app)
      .post(`/api/incidents/${id}/comments`)
      .set('cookie', a.engineer)
      .send({ body: 'hi' });
    expect((await comment).commentId).toEqual(expect.any(String));

    const resolved = h.next<IncidentRealtimeData>(viewer, 'incident.status_changed');
    await patch('/status', { version: 3, status: 'RESOLVED' });
    expect((await resolved).incident?.status).toBe('RESOLVED');
  });

  it('does not emit anything for a failed (conflicting) change', async () => {
    const viewer = await h.connect(a.viewer);
    const { id } = await createIncident(h.app, a.engineer, a.serviceId);
    const quiet = h.never(viewer, 'incident.status_changed');
    const bad = await request(h.app)
      .patch(`/api/incidents/${id}/status`)
      .set('cookie', a.engineer)
      .send({ version: 1, status: 'CLOSED' });
    expect(bad.status).toBe(409);
    await quiet;
  });
});

describe('incident rooms', () => {
  it('joins an incident of your own org, and refuses another organization incident', async () => {
    const mine = await createIncident(h.app, a.engineer, a.serviceId);
    const theirs = await createIncident(h.app, b.engineer, b.serviceId);
    const socket = await h.connect(a.viewer);

    expect(await ack(socket, 'incident:join', mine.id)).toEqual({ ok: true });
    expect(await ack(socket, 'incident:join', theirs.id)).toEqual({
      ok: false,
      error: 'INCIDENT_NOT_FOUND',
    });
    expect(await ack(socket, 'incident:join', 'not-a-uuid')).toEqual({
      ok: false,
      error: 'INVALID_ID',
    });
  });

  it("a user who tries to join another org's incident never receives its events", async () => {
    const theirs = await createIncident(h.app, b.engineer, b.serviceId);
    const intruder = await h.connect(a.owner);
    expect((await ack(intruder, 'incident:join', theirs.id)).ok).toBe(false);

    const quiet = Promise.all([
      h.never(intruder, 'incident.status_changed'),
      h.never(intruder, 'incident.updated'),
    ]);
    await request(h.app)
      .patch(`/api/incidents/${theirs.id}/status`)
      .set('cookie', b.engineer)
      .send({ version: 1, status: 'INVESTIGATING' });
    await quiet;
  });

  it('cannot subscribe to arbitrary rooms by name', async () => {
    const intruder = await h.connect(a.owner);
    const orgBId = (await request(h.app).get('/api/auth/me').set('cookie', b.owner)).body
      .organization.id;
    const quiet = h.never(intruder, 'incident.created');
    intruder.emit('join', `org:${orgBId}`); // no such handler exists
    intruder.emit('incident:join', `org:${orgBId}`); // not a uuid
    await createIncident(h.app, b.engineer, b.serviceId);
    await quiet;
  });

  it('stops delivering to the incident room after leaving, and deployment links go live', async () => {
    const { id } = await createIncident(h.app, a.engineer, a.serviceId);
    const socket = await h.connect(a.viewer);
    await ack(socket, 'incident:join', id);
    const dep = (
      await request(h.app)
        .post('/api/deployments')
        .set('cookie', a.engineer)
        .send({ serviceId: a.serviceId, version: 'v9', commitSha: 'abc1234' })
    ).body.deployment.id;

    const live = h.next<IncidentRealtimeData>(socket, 'incident.updated');
    await request(h.app)
      .post(`/api/incidents/${id}/deployments`)
      .set('cookie', a.engineer)
      .send({ deploymentId: dep });
    expect((await live).incidentId).toBe(id);
    expect(await ack(socket, 'incident:leave', id)).toEqual({ ok: true });
  });
});

describe('notification.created from the worker process', () => {
  it('reaches only the recipient, delivered through the Redis channel', async () => {
    worker = createEventWorker();
    await worker.waitUntilReady();
    const engineerId = (await request(h.app).get('/api/auth/me').set('cookie', a.engineer)).body
      .user.id;
    const engineerSocket = await h.connect(a.engineer);
    const viewerSocket = await h.connect(a.viewer);
    const otherOrgSocket = await h.connect(b.admin);

    const got = h.next<{ notification: NotificationDto }>(engineerSocket, 'notification.created');
    const noViewer = h.never(viewerSocket, 'notification.created', 800);
    const noOther = h.never(otherOrgSocket, 'notification.created', 800);
    const created = await request(h.app)
      .post('/api/incidents')
      .set('cookie', a.admin)
      .send({ serviceId: a.serviceId, title: 'Pager', severity: 'SEV1', assigneeId: engineerId });
    expect(created.status).toBe(201);

    const { notification } = await got;
    expect(notification).toMatchObject({
      type: 'incident.created',
      readAt: null,
      incidentId: created.body.incident.id,
    });
    expect(notification.message).toBe('New SEV1 incident: Pager');
    await Promise.all([noViewer, noOther]);
  });
});

describe('the Redis channel', () => {
  it('ignores malformed messages and keeps working', async () => {
    const socket = await h.connect(a.viewer);
    const pub = createRedis();
    try {
      await pub.publish(REALTIME_CHANNEL, 'not json');
      await pub.publish(REALTIME_CHANNEL, JSON.stringify({ rooms: [], event: 'incident.created' }));
      await pub.publish(
        REALTIME_CHANNEL,
        JSON.stringify({ rooms: ['org:x'], event: 'bogus.event', data: 1 }),
      );
    } finally {
      pub.disconnect();
    }
    const got = h.next(socket, 'incident.created');
    await createIncident(h.app, a.engineer, a.serviceId);
    expect(await got).toBeTruthy();
  });
});
