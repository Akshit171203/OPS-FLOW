import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../lib/config';

const base = {
  WEB_ORIGIN: 'http://localhost:3140',
  DATABASE_URL: 'postgres://u:p@h/db',
  REDIS_URL: 'redis://h:6379',
  JWT_SECRET: 'x'.repeat(32),
};
const parse = (over: Record<string, string>) => ConfigSchema.safeParse({ ...base, ...over });

describe('configuration', () => {
  it('applies safe defaults: workers separate, demo off, AI offline, a daily AI cap', () => {
    const c = ConfigSchema.parse(base);
    expect(c).toMatchObject({
      EMBEDDED_WORKERS: false,
      DEMO_MODE: false,
      AI_PROVIDER: 'fake',
      AI_DAILY_CAP: 200,
      TRUST_PROXY: 0,
    });
    expect(c.COOKIE_SECURE).toBeUndefined(); // so the default (Secure in production) applies
  });

  it('parses the on/off switches from strings', () => {
    expect(
      ConfigSchema.parse({
        ...base,
        DEMO_MODE: 'true',
        EMBEDDED_WORKERS: 'true',
        COOKIE_SECURE: 'false',
      }),
    ).toMatchObject({
      DEMO_MODE: true,
      EMBEDDED_WORKERS: true,
      COOKIE_SECURE: false,
    });
    expect(parse({ DEMO_MODE: 'yes' }).success).toBe(false); // typos are errors, not silently "off"
  });

  it('refuses a public http:// web address in production, with a clear message', () => {
    const r = parse({ NODE_ENV: 'production', WEB_ORIGIN: 'http://opsflow.example.com' });
    expect(r.success).toBe(false);
    if (!r.success)
      expect(r.error.issues[0]).toMatchObject({
        path: ['WEB_ORIGIN'],
        message: expect.stringContaining('https://'),
      });
  });

  it.each([
    ['production', 'https://opsflow.example.com'],
    ['production', 'http://localhost:3140'],
    ['production', 'http://127.0.0.1:3140'],
    ['development', 'http://opsflow.example.com'],
  ])('accepts %s with %s', (NODE_ENV, WEB_ORIGIN) => {
    expect(parse({ NODE_ENV, WEB_ORIGIN }).success).toBe(true);
  });

  it('does not let "localhost" be faked by a lookalike host', () => {
    expect(parse({ NODE_ENV: 'production', WEB_ORIGIN: 'http://localhost.evil.com' }).success).toBe(
      false,
    );
  });

  it('requires a long JWT secret', () => {
    expect(parse({ JWT_SECRET: 'short' }).success).toBe(false);
  });
});
