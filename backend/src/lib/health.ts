import { pool } from '../db/client';
import { getSharedRedis } from './redis';

let draining = false;
/** Set when shutdown begins so /ready reports 503 and load balancers stop sending traffic. */
export const setDraining = (value: boolean) => {
  draining = value;
};
export const isDraining = () => draining;

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref()),
  ]);

export interface Readiness {
  ready: boolean;
  checks: { postgres: 'ok' | 'fail'; redis: 'ok' | 'fail'; draining?: true };
}

/** Ready means this process can actually serve requests: Postgres and Redis both answer. */
export async function checkReadiness(timeoutMs = 2000): Promise<Readiness> {
  const [pg, redis] = await Promise.all([
    withTimeout(pool.query('SELECT 1'), timeoutMs).then(
      () => 'ok' as const,
      () => 'fail' as const,
    ),
    withTimeout(getSharedRedis().ping(), timeoutMs).then(
      () => 'ok' as const,
      () => 'fail' as const,
    ),
  ]);
  const checks: Readiness['checks'] = {
    postgres: pg,
    redis,
    ...(draining ? { draining: true as const } : {}),
  };
  return { ready: pg === 'ok' && redis === 'ok' && !draining, checks };
}
