import { Redis } from 'ioredis';
import { config } from './config';

/**
 * BullMQ needs `maxRetriesPerRequest: null` so blocking commands are not aborted.
 * Each Queue/Worker gets its own connection: workers use blocking commands.
 */
export function createRedis(): Redis {
  return new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
}
