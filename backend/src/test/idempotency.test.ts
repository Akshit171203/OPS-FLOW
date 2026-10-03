import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../db/client';
import { idempotencyKeys } from '../db/schema';
import { processOnce } from '../lib/idempotency';
import { resetDb } from './helpers';

afterAll(() => pool.end());
beforeEach(resetDb);

describe('processOnce', () => {
  it('runs once per key and scope, but again for another scope', async () => {
    let runs = 0;
    const work = async () => ++runs;
    expect(await processOnce('k1', 's', work)).toEqual({ ran: true, result: 1 });
    expect(await processOnce('k1', 's', work)).toEqual({ ran: false });
    expect((await processOnce('k1', 'other', work)).ran).toBe(true);
    expect(runs).toBe(2);
  });

  it('ten concurrent callers: exactly one runs the work', async () => {
    let runs = 0;
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        processOnce('race', 's', async () => {
          runs += 1;
          await new Promise((r) => setTimeout(r, 50));
        }),
      ),
    );
    expect(runs).toBe(1);
    expect(results.filter((r) => r.ran)).toHaveLength(1);
  });

  it('a failed attempt does not burn the key, so the retry runs', async () => {
    await expect(
      processOnce('flaky', 's', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await db.select().from(idempotencyKeys)).toHaveLength(0);
    expect((await processOnce('flaky', 's', async () => 'ok')).ran).toBe(true);
  });
});
