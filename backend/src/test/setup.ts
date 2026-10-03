import { afterAll, beforeEach } from 'vitest';
import { closeQueues } from '../events/queues';
import { closeRealtimePublisher } from '../realtime/channel';
import { closeSharedRedis, getSharedRedis, redisKey } from '../lib/redis';

// Rate limits are keyed by IP, user and email, which tests reuse constantly. Start every test
// with empty counters so limits never leak between tests; the rate-limit tests set their own.
beforeEach(async () => {
  const redis = getSharedRedis();
  const keys = await redis.keys(redisKey('rl', '*'));
  if (keys.length) await redis.del(...keys);
});

afterAll(async () => {
  await closeQueues();
  await closeRealtimePublisher();
  await closeSharedRedis();
});
