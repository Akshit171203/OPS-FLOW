import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from './request';
import { buildApp } from '../app';
import { db, pool } from '../db/client';
import { notifications } from '../db/schema';
import { getEventsQueue } from '../events/queues';
import { publishEvent } from '../events/publisher';
import { config } from '../lib/config';
import { isDraining, setDraining } from '../lib/health';
import { getSharedRedis } from '../lib/redis';
import { gracefulShutdown } from '../lib/shutdown';
import { createEventWorker } from '../workers/eventWorker';
import { resetDb, setupOrg, sleep, userIdOf, waitFor } from './helpers';
import { buildEvent } from '../events/publisher';

const app = buildApp();
afterAll(() => pool.end());
beforeEach(async () => {
  vi.restoreAllMocks();
  setDraining(false);
});
afterEach(() => setDraining(false));

describe('health and readiness', () => {
  it('/health is liveness only; /ready checks Postgres and Redis', async () => {
    expect((await request(app).get('/health')).body).toEqual({ status: 'ok' });
    const ready = await request(app).get('/ready');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: 'ready', checks: { postgres: 'ok', redis: 'ok' } });
  });

  it('/ready fails with 503 when Redis is down, while /health stays 200', async () => {
    vi.spyOn(getSharedRedis(), 'ping').mockRejectedValue(new Error('connection refused'));
    const ready = await request(app).get('/ready');
    expect(ready.status).toBe(503);
    expect(ready.body).toEqual({
      status: 'unavailable',
      checks: { postgres: 'ok', redis: 'fail' },
    });
    expect((await request(app).get('/health')).status).toBe(200);
  });

  it('/ready fails with 503 when Postgres is down', async () => {
    vi.spyOn(pool, 'query').mockRejectedValueOnce(new Error('connection refused') as never);
    const ready = await request(app).get('/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.checks).toEqual({ postgres: 'fail', redis: 'ok' });
  });

  it('/ready fails when a dependency hangs, instead of hanging itself', async () => {
    vi.spyOn(getSharedRedis(), 'ping').mockImplementation(
      () => new Promise(() => undefined) as never,
    );
    const started = Date.now();
    const ready = await request(app).get('/ready');
    expect(ready.status).toBe(503);
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it('/ready reports 503 once shutdown has begun, so traffic drains away', async () => {
    setDraining(true);
    const ready = await request(app).get('/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.checks.draining).toBe(true);
  });
});

describe('graceful shutdown of an HTTP server', () => {
  it('finishes the in-flight request, refuses new ones, then runs cleanup in order', async () => {
    const events: string[] = [];
    const server = createServer((_req, res) => {
      events.push('request started');
      setTimeout(() => {
        events.push('request finished');
        res.end('done');
      }, 300);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const url = `http://127.0.0.1:${port}/`;

    const inFlight = fetch(url).then(async (r) => ({ status: r.status, body: await r.text() }));
    await waitFor(() => events.includes('request started'));

    const shutdown = gracefulShutdown({
      closeServer: () => new Promise<void>((r) => server.close(() => r())),
      cleanup: [
        async () => void events.push('cleanup 1'),
        async () => void events.push('cleanup 2'),
      ],
      timeoutMs: 5000,
    });
    expect(isDraining()).toBe(true);
    await sleep(50);
    await expect(fetch(url)).rejects.toThrow(); // new connections are refused during drain

    expect(await inFlight).toEqual({ status: 200, body: 'done' }); // the in-flight request still completed
    await shutdown;
    expect(events).toEqual(['request started', 'request finished', 'cleanup 1', 'cleanup 2']);
  });

  it('keeps going if a cleanup step fails, and calls onTimeout if shutdown hangs', async () => {
    const ran: string[] = [];
    await gracefulShutdown({
      closeServer: async () => undefined,
      cleanup: [
        async () => {
          throw new Error('redis already closed');
        },
        async () => void ran.push('second step still ran'),
      ],
      timeoutMs: 1000,
    });
    expect(ran).toEqual(['second step still ran']);

    const onTimeout = vi.fn();
    const hung = gracefulShutdown({
      closeServer: () => new Promise(() => undefined),
      cleanup: [],
      timeoutMs: 80,
      onTimeout,
    });
    await sleep(200);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    void hung;
  });
});

describe('graceful shutdown of the worker', () => {
  it('a worker stopped mid-job completes that job before exiting, with no retry', async () => {
    await getEventsQueue().obliterate({ force: true });
    await resetDb();
    const o = await setupOrg(app);
    const adminId = await userIdOf(app, o.admin);
    const orgId = (await request(app).get('/api/auth/me').set('cookie', o.admin)).body.organization
      .id;

    let started = 0;
    let finished = 0;
    const worker = createEventWorker({
      handler: async () => {
        started += 1;
        await sleep(500);
        finished += 1;
      },
    });
    await worker.waitUntilReady();
    await publishEvent(
      buildEvent(
        {
          type: 'notification.requested',
          payload: { userId: adminId, notificationType: 'ping', message: 'slow' },
        },
        { organizationId: orgId, requestId: 'req-shutdown' },
      ),
    );
    await waitFor(() => started === 1);

    await gracefulShutdown({ closeServer: () => worker.close(), cleanup: [], timeoutMs: 5000 });

    expect(finished).toBe(1); // the active job ran to completion before close() returned
    const queue = getEventsQueue();
    expect(await queue.getCompletedCount()).toBe(1);
    expect(await queue.getFailedCount()).toBe(0);
    await sleep(150);
    expect(started).toBe(1); // never retried
    void db;
    void notifications;
    void config;
  });
});

describe('database pool', () => {
  it('is configured explicitly rather than left at library defaults', () => {
    expect(pool.options.max).toBe(config.DB_POOL_MAX);
    expect(pool.options.idleTimeoutMillis).toBe(config.DB_POOL_IDLE_MS);
    expect(pool.options.connectionTimeoutMillis).toBe(config.DB_POOL_CONNECT_TIMEOUT_MS);
    expect((pool.options as { statement_timeout?: number }).statement_timeout).toBe(
      config.DB_STATEMENT_TIMEOUT_MS,
    );
  });
});
