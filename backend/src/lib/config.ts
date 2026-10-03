import { z } from 'zod';

try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  // no .env file; rely on the real environment
}

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4100),
  WEB_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),
  /** Number of reverse-proxy hops in front of the API (0 = none). Controls how req.ip is derived. */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  COOKIE_SAMESITE: z.enum(['lax', 'strict']).default('lax'),
  COOKIE_DOMAIN: z.string().min(1).optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).default(10),
  DB_POOL_IDLE_MS: z.coerce.number().int().min(0).default(30_000),
  DB_POOL_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1).default(5_000),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(15_000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1).default(10_000),
  QUEUE_PREFIX: z.string().min(1).default('opsflow'),
  /** Comma-separated backoff delays (ms) applied after the 1st, 2nd, ... failed attempt. */
  RETRY_DELAYS_MS: z
    .string()
    .default('1000,5000,30000')
    .transform((v) => v.split(',').map((n) => Number(n.trim())))
    .pipe(z.array(z.number().int().min(0)).min(1)),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(5),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;

export const config: Config = ConfigSchema.parse(process.env);
export const isProduction = config.NODE_ENV === 'production';
