import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from './request';
import { buildApp } from '../app';
import { pool } from '../db/client';
import { ConflictError } from '../lib/errors';
import { acquireLock, releaseLock, withLock } from '../lib/locks';
import { resetDb, setupOrg, sleep } from './helpers';

const app = buildApp();
afterAll(() => pool.end());
beforeEach(resetDb);

const newKey = () => `test:${randomUUID()}`;

describe('withLock', () => {
  it('two concurrent calls on the same key: exactly one runs, the other gets 409 LOCK_HELD', async () => {
    const key = newKey();
    let runs = 0;
    const work = async () => {
      runs += 1;
      await sleep(150);
      return 'done';
    };
    const results = await Promise.allSettled([
      withLock(key, 5000, work),
      withLock(key, 5000, work),
    ]);
    expect(runs).toBe(1);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(ConflictError);
    expect(rejected[0]!.reason.code).toBe('LOCK_HELD');
  });

  it('releases after completion', async () => {
    const key = newKey();
    await withLock(key, 5000, async () => 1);
    expect(await withLock(key, 5000, async () => 2)).toBe(2);
  });

  it('releases after the function throws, and rethrows the original error', async () => {
    const key = newKey();
    await expect(
      withLock(key, 5000, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await withLock(key, 5000, async () => 'after')).toBe('after');
  });

  it('different keys do not block each other', async () => {
    const [a, b] = await Promise.all([
      withLock(newKey(), 5000, async () => {
        await sleep(50);
        return 'a';
      }),
      withLock(newKey(), 5000, async () => {
        await sleep(50);
        return 'b';
      }),
    ]);
    expect([a, b]).toEqual(['a', 'b']);
  });

  it('is held while the function runs', async () => {
    const key = newKey();
    await withLock(key, 5000, async () => {
      expect(await acquireLock(key, 5000)).toBeNull();
    });
    expect(await acquireLock(key, 5000)).not.toBeNull();
  });
});

describe('lock ownership', () => {
  it('an expired lock cannot be released by its old holder, who must not free the new holder', async () => {
    const key = newKey();
    const oldToken = await acquireLock(key, 100);
    expect(oldToken).not.toBeNull();
    await sleep(160); // expired
    const newToken = await acquireLock(key, 5000);
    expect(newToken).not.toBeNull();
    expect(newToken).not.toBe(oldToken);

    expect(await releaseLock(key, oldToken!)).toBe(false); // old holder: no effect
    expect(await acquireLock(key, 5000)).toBeNull(); // still held by the new holder
    expect(await releaseLock(key, newToken!)).toBe(true);
    expect(await acquireLock(key, 5000)).not.toBeNull();
  });

  it('a lock frees itself after its TTL even if never released (crashed holder)', async () => {
    const key = newKey();
    await acquireLock(key, 80);
    expect(await acquireLock(key, 80)).toBeNull();
    await sleep(120);
    expect(await acquireLock(key, 80)).not.toBeNull();
  });
});

describe('Simulate is guarded by a per-organization lock', () => {
  it('a double click creates one incident; the second request gets 409, and it works again afterwards', async () => {
    const o = await setupOrg(app);
    const fire = () => request(app).post('/api/demo/simulate-incident').set('cookie', o.admin);
    const [a, b] = await Promise.all([fire(), fire()]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error.code).toBe('LOCK_HELD');
    expect((await request(app).get('/api/incidents').set('cookie', o.admin)).body.total).toBe(1);
    expect((await fire()).status).toBe(201); // lock was released
  });
});
