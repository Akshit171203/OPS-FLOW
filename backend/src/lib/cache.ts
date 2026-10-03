import { logger } from './logger';
import { getSharedRedis, redisKey } from './redis';

export const cacheKeys = {
  dashboard: (orgId: string) => `org:${orgId}:dashboard`,
  serviceHealth: (orgId: string) => `org:${orgId}:service-health`,
};

/**
 * Read-through cache: return the cached JSON for `key`, else run `loader`, store the result for
 * `ttlSeconds`, and return it. Redis failures never break the request: on a read error the loader
 * runs, and a failed write is ignored (the next request simply recomputes).
 * Values must be JSON-serializable. The TTL also bounds staleness if an invalidation is missed.
 */
export async function getOrSet<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<T> {
  const fullKey = redisKey('cache', key);
  try {
    const hit = await getSharedRedis().get(fullKey);
    if (hit !== null) return JSON.parse(hit) as T;
  } catch (err) {
    logger.warn({ err, key }, 'cache read failed, falling back to the database');
  }
  const value = await loader();
  try {
    await getSharedRedis().set(fullKey, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    logger.warn({ err, key }, 'cache write failed');
  }
  return value;
}

/** Drop cached entries after the data behind them changed. Call after the commit. */
export async function invalidate(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await getSharedRedis().del(...keys.map((k) => redisKey('cache', k)));
  } catch (err) {
    logger.warn({ err, keys }, 'cache invalidation failed; entries expire by TTL');
  }
}

/** Everything derived from incidents, services, metrics or deployments for one organization. */
export const invalidateOrgViews = (orgId: string) =>
  invalidate(cacheKeys.dashboard(orgId), cacheKeys.serviceHealth(orgId));
