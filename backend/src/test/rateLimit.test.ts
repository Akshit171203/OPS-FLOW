import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from './request';
import { buildApp } from '../app';
import { pool } from '../db/client';
import { consume } from '../lib/rateLimiter';
import { getSharedRedis } from '../lib/redis';
import { createIncident, register, resetDb, setupOrg, sleep, type TestOrg } from './helpers';

const app = buildApp();
afterAll(() => pool.end());
beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDb();
});

const login = (email: string, ip?: string) => {
  const r = request(app).post('/api/auth/login');
  if (ip) r.set('x-forwarded-for', ip);
  return r.send({ email, password: 'wrong-password-123' });
};

describe('login limit: 5 per minute per IP + email', () => {
  it('the 6th attempt in a minute returns 429 with Retry-After', async () => {
    await register(app);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await login('owner@example.com')).status);
    expect(statuses).toEqual([401, 401, 401, 401, 401]);

    const blocked = await login('owner@example.com');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    const retryAfter = Number(blocked.headers['retry-after']);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(blocked.headers['ratelimit-remaining']).toBe('0');
  });

  it('a blocked attempt does not even check the password, and correct credentials are blocked too', async () => {
    const { payload } = await register(app);
    for (let i = 0; i < 5; i++) await login(payload.email);
    const right = await request(app)
      .post('/api/auth/login')
      .send({ email: payload.email, password: payload.password });
    expect(right.status).toBe(429);
  });

  it('limits are per key, not global: another email and another IP are unaffected', async () => {
    await register(app);
    for (let i = 0; i < 6; i++) await login('owner@example.com', '10.0.0.1');
    expect((await login('owner@example.com', '10.0.0.1')).status).toBe(429);
    expect((await login('someone-else@example.com', '10.0.0.1')).status).toBe(401); // other email, same IP
    expect((await login('owner@example.com', '10.0.0.2')).status).toBe(401); // same email, other IP
  });

  it('email case and whitespace do not create a fresh bucket', async () => {
    for (let i = 0; i < 5; i++) await login('Owner@Example.com');
    expect((await login(' owner@example.com ')).status).toBe(429);
  });

  it('rotating IPs against one account is stopped by the per-email backstop (20 per minute)', async () => {
    const results: number[] = [];
    for (let i = 0; i < 21; i++)
      results.push((await login('victim@example.com', `10.1.0.${i + 1}`)).status);
    expect(results.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(results[20]).toBe(429);
  });

  it('successful logins are counted too', async () => {
    const { payload } = await register(app);
    for (let i = 0; i < 5; i++) {
      expect(
        (
          await request(app)
            .post('/api/auth/login')
            .send({ email: payload.email, password: payload.password })
        ).status,
      ).toBe(200);
    }
    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .send({ email: payload.email, password: payload.password })
      ).status,
    ).toBe(429);
  });
});

describe('other limits', () => {
  let o: TestOrg;
  beforeEach(async () => {
    o = await setupOrg(app);
  });

  it('incident creation: 20 per minute per user; the 21st is 429 and other users are unaffected', async () => {
    for (let i = 0; i < 20; i++)
      await createIncident(app, o.engineer, o.serviceId, { title: `i${i}` });
    const blocked = await request(app)
      .post('/api/incidents')
      .set('cookie', o.engineer)
      .send({ serviceId: o.serviceId, title: 'one too many', severity: 'SEV3' });
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    const other = await request(app)
      .post('/api/incidents')
      .set('cookie', o.admin)
      .send({ serviceId: o.serviceId, title: 'fine', severity: 'SEV3' });
    expect(other.status).toBe(201);
  }, 30_000);

  it('log ingestion: 300 requests per minute per organization, enforced atomically under concurrency', async () => {
    const body = { serviceId: o.serviceId, level: 'INFO', message: 'x' };
    const results = await Promise.all(
      Array.from({ length: 310 }, () =>
        request(app).post('/api/logs').set('cookie', o.engineer).send(body),
      ),
    );
    const ok = results.filter((r) => r.status === 201).length;
    const limited = results.filter((r) => r.status === 429).length;
    expect(ok).toBe(300);
    expect(limited).toBe(10);
    // another organization has its own budget
    const other = await setupOrg(app, 'b');
    const res = await request(app)
      .post('/api/logs')
      .set('cookie', other.engineer)
      .send({ ...body, serviceId: other.serviceId });
    expect(res.status).toBe(201);
  }, 60_000);

  it('registration: 10 per hour per IP', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post('/api/auth/register')
        .set('x-forwarded-for', '9.9.9.9')
        .send({
          email: `reg${i}@example.com`,
          password: 'correct-horse-battery',
          name: 'R',
          organizationName: `Org ${i}`,
        });
      expect(res.status).toBe(201);
    }
    const blocked = await request(app)
      .post('/api/auth/register')
      .set('x-forwarded-for', '9.9.9.9')
      .send({
        email: 'reg-extra@example.com',
        password: 'correct-horse-battery',
        name: 'R',
        organizationName: 'Extra',
      });
    expect(blocked.status).toBe(429);
  }, 30_000);
});

describe('the limiter itself', () => {
  it('is a sliding window: capacity returns as old hits leave the window', async () => {
    const rule = { name: `test-${randomUUID()}`, limit: 3, windowMs: 400 };
    for (let i = 0; i < 3; i++) expect((await consume(rule, 'k')).allowed).toBe(true);
    const blocked = await consume(rule, 'k');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(400);
    await sleep(450);
    expect((await consume(rule, 'k')).allowed).toBe(true);
  });

  it('counts remaining capacity and keeps keys independent', async () => {
    const rule = { name: `test-${randomUUID()}`, limit: 2, windowMs: 5000 };
    expect((await consume(rule, 'a')).remaining).toBe(1);
    expect((await consume(rule, 'a')).remaining).toBe(0);
    expect((await consume(rule, 'b')).remaining).toBe(1);
  });

  it('fails open when Redis is unavailable: the request is served, not rejected', async () => {
    await register(app);
    vi.spyOn(getSharedRedis(), 'eval').mockRejectedValue(new Error('redis down'));
    const res = await login('owner@example.com');
    expect(res.status).toBe(401); // reached the real handler instead of 500/429
  });
});
