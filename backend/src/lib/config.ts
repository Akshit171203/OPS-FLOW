import { z } from 'zod';

try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  // no .env file; rely on the real environment
}

export const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4100),
    WEB_ORIGIN: z.string().url(),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    JWT_SECRET: z.string().min(32),
    JWT_EXPIRES_IN: z.string().default('7d'),
    /** Number of reverse-proxy hops in front of the API (0 = none). Controls how req.ip is derived. */
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    /** Override the session cookie's Secure flag. Default: on in production. Turn off only to try a production build over plain http on localhost. */
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
    COOKIE_SAMESITE: z.enum(['lax', 'strict']).default('lax'),
    COOKIE_DOMAIN: z.string().min(1).optional(),
    DB_POOL_MAX: z.coerce.number().int().min(1).default(10),
    DB_POOL_IDLE_MS: z.coerce.number().int().min(0).default(30_000),
    DB_POOL_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1).default(5_000),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(15_000),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1).default(10_000),
    /** 'fake' runs fully offline (deterministic); 'gemini' calls the real API and needs GEMINI_API_KEY. */
    AI_PROVIDER: z.enum(['fake', 'gemini']).default('fake'),
    GEMINI_API_KEY: z.string().min(1).optional(),
    GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash'),
    GEMINI_EMBEDDING_MODEL: z.string().min(1).default('gemini-embedding-001'),
    GEMINI_BASE_URL: z.string().url().default('https://generativelanguage.googleapis.com/v1beta'),
    AI_TIMEOUT_MS: z.coerce.number().int().min(1).default(30_000),
    /** Run the background workers inside the API process. For hosts with no free background workers; one process, shared CPU. */
    EMBEDDED_WORKERS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    /** Public demo: a "Try the demo" button, shared read-mostly demo account, periodic reset. Never enable on a real tenant database. */
    DEMO_MODE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    /** Re-create the demo data this often (hours). 0 turns the reset off. */
    DEMO_RESET_HOURS: z.coerce.number().min(0).default(12),
    /** Most AI analyses an organization can start in 24 hours: protects the API key from runaway cost. */
    AI_DAILY_CAP: z.coerce.number().int().min(0).default(200),
    QUEUE_PREFIX: z.string().min(1).default('opsflow'),
    /** Comma-separated backoff delays (ms) applied after the 1st, 2nd, ... failed attempt. */
    RETRY_DELAYS_MS: z
      .string()
      .default('1000,5000,30000')
      .transform((v) => v.split(',').map((n) => Number(n.trim())))
      .pipe(z.array(z.number().int().min(0)).min(1)),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(5),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  // Catch the classic production misconfiguration at startup instead of as a confusing login failure later:
  // session cookies are Secure in production, so a public http:// web address would silently never sign anyone in.
  .superRefine((c, ctx) => {
    const local = /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(c.WEB_ORIGIN);
    if (c.NODE_ENV === 'production' && !c.WEB_ORIGIN.startsWith('https://') && !local) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEB_ORIGIN'],
        message:
          'must be an https:// address in production (plain http is only allowed for localhost)',
      });
    }
  });

export type Config = z.infer<typeof ConfigSchema>;

export const config: Config = ConfigSchema.parse(process.env);
export const isProduction = config.NODE_ENV === 'production';
