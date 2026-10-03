import { Redis } from 'ioredis';
import { config } from './config';

/**
 * BullMQ needs `maxRetriesPerRequest: null` so blocking commands are not aborted.
 * Each Queue/Worker gets its own connection: workers use blocking commands.
 */
export function createRedis(): Redis {
  return new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
}

let shared: Redis | undefined;

/**
 * Shared connection for short request-time commands (rate limits, cache, locks, readiness).
 * It fails fast: one retry and a 1s command timeout, so Redis trouble degrades a request
 * quickly instead of hanging it. Queues and workers use their own connections (createRedis).
 */
export function getSharedRedis(): Redis {
  shared ??= new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 1,
    commandTimeout: 1000,
  });
  shared.on('error', () => undefined); // surfaced per command; avoids unhandled 'error' events
  return shared;
}

export async function closeSharedRedis(): Promise<void> {
  const r = shared;
  shared = undefined;
  if (r) await r.quit().catch(() => r.disconnect());
}

/** Key namespace so several environments can share one Redis safely. */
export const redisKey = (...parts: string[]) => [config.QUEUE_PREFIX, ...parts].join(':');
