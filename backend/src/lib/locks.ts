import { randomUUID } from 'node:crypto';
import { ConflictError } from './errors';
import { logger } from './logger';
import { getSharedRedis, redisKey } from './redis';

/** Delete the lock only if it still holds OUR token, so an expired lock never frees someone else's. */
const RELEASE = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

/** Try to take the lock; returns a token on success or null if it is held. */
export async function acquireLock(key: string, ttlMs: number): Promise<string | null> {
  const token = randomUUID();
  const ok = await getSharedRedis().set(redisKey('lock', key), token, 'PX', ttlMs, 'NX');
  return ok === 'OK' ? token : null;
}

export async function releaseLock(key: string, token: string): Promise<boolean> {
  const released = await getSharedRedis().eval(RELEASE, 1, redisKey('lock', key), token);
  return released === 1;
}

/**
 * Run `fn` while holding the lock `key`. If another holder has it, throws a ConflictError (409
 * LOCK_HELD) without running `fn`. The lock is released afterwards even if `fn` throws. The TTL
 * is a safety net: if the process dies the lock frees itself; choose it longer than `fn` can take.
 */
export async function withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const token = await acquireLock(key, ttlMs);
  if (!token) throw new ConflictError('Another operation is already in progress', 'LOCK_HELD');
  try {
    return await fn();
  } finally {
    await releaseLock(key, token).catch((err) =>
      logger.error({ err, key }, 'failed to release lock'),
    );
  }
}
