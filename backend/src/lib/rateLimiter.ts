import { getSharedRedis, redisKey } from './redis';

export interface RateLimitRule {
  name: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Sliding-window log in a sorted set, evaluated atomically in Redis. Each allowed hit adds a
 * member scored by time; hits older than the window are dropped first. Using Redis' own clock
 * keeps several API instances consistent. When the limit is reached the reply says how long
 * until the oldest hit leaves the window.
 */
const SLIDING_WINDOW = `
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
local count = redis.call('ZCARD', KEYS[1])
if count >= limit then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {0, 0, tonumber(oldest[2]) + window - now}
end
redis.call('ZADD', KEYS[1], now, ARGV[3])
redis.call('PEXPIRE', KEYS[1], window)
return {1, limit - count - 1, 0}
`;

let sequence = 0;

export async function consume(rule: RateLimitRule, key: string): Promise<RateLimitResult> {
  const member = `${Date.now()}-${process.pid}-${sequence++}-${Math.random().toString(36).slice(2, 8)}`;
  const [allowed, remaining, retryAfterMs] = (await getSharedRedis().eval(
    SLIDING_WINDOW,
    1,
    redisKey('rl', rule.name, key),
    rule.windowMs,
    rule.limit,
    member,
  )) as [number, number, number];
  return { allowed: allowed === 1, remaining, retryAfterMs: Math.max(retryAfterMs, 0) };
}
