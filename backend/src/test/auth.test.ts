import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from './request';
import { eq } from 'drizzle-orm';
import { buildApp } from '../app';
import { db, pool } from '../db/client';
import { organizationMembers, organizations, users } from '../db/schema';
import { authRepository } from '../modules/auth/repository';
import { cookieFrom, register, resetDb } from './helpers';

const app = buildApp();

afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDb();
});

describe('register', () => {
  it('creates user, organization and OWNER membership', async () => {
    const { res } = await register(app);
    expect(res.status).toBe(201);
    const [m] = await db.select().from(organizationMembers);
    expect(m?.role).toBe('OWNER');
    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(organizations)).toHaveLength(1);
  });

  it('rolls everything back when the membership insert fails', async () => {
    vi.spyOn(authRepository, 'insertMember').mockRejectedValueOnce(new Error('boom'));
    const { res } = await register(app);
    expect(res.status).toBe(500);
    expect(await db.select().from(users)).toHaveLength(0);
    expect(await db.select().from(organizations)).toHaveLength(0);
    expect(await db.select().from(organizationMembers)).toHaveLength(0);
  });

  it('returns 409 with a clear code for a duplicate email', async () => {
    await register(app);
    const { res } = await register(app, { email: 'OWNER@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('stores an argon2 hash, never the password', async () => {
    const { payload } = await register(app);
    const [u] = await db.select().from(users).where(eq(users.email, payload.email));
    expect(u?.passwordHash.startsWith('$argon2')).toBe(true);
  });

  it('rejects an invalid body with the standard error shape', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('login / me / logout', () => {
  it('wrong password and unknown email return the same 401', async () => {
    const { payload } = await register(app);
    const wrong = await request(app)
      .post('/api/auth/login')
      .send({ email: payload.email, password: 'nope-nope-nope' });
    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@example.com', password: 'nope-nope-nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe(unknown.body.error.code);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('sets an HTTP-only cookie and /me works with it', async () => {
    const { payload } = await register(app);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: payload.email, password: payload.password });
    expect(login.status).toBe(200);
    const raw = String(login.headers['set-cookie']);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    const me = await request(app).get('/api/auth/me').set('cookie', cookieFrom(login));
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ user: { email: payload.email }, role: 'OWNER' });
  });

  it('/me returns 401 without a cookie or with a garbage one', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    const bad = await request(app).get('/api/auth/me').set('cookie', 'opsflow_token=garbage');
    expect(bad.status).toBe(401);
  });

  it('logout clears the cookie', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(204);
    expect(String(res.headers['set-cookie'])).toMatch(/opsflow_token=;/);
  });
});

describe('request id and error shape', () => {
  it('echoes a supplied x-request-id and generates one otherwise', async () => {
    const a = await request(app).get('/health').set('x-request-id', 'abc-123');
    expect(a.headers['x-request-id']).toBe('abc-123');
    const b = await request(app).get('/health');
    expect(b.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('ignores an unsafe x-request-id', async () => {
    const res = await request(app).get('/health').set('x-request-id', 'bad id with spaces');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('every error response matches the standard shape', async () => {
    const responses = [
      await request(app).get('/nope'),
      await request(app).get('/api/auth/me'),
      await request(app).post('/api/auth/login').send({}),
      await request(app)
        .post('/api/auth/login')
        .set('content-type', 'application/json')
        .send('{bad json'),
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'a@b.co', password: 'x'.repeat(2 * 1024 * 1024) }),
    ];
    for (const r of responses) {
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.body.error).toMatchObject({
        code: expect.any(String),
        message: expect.any(String),
        requestId: expect.any(String),
      });
    }
    expect(responses[4]!.status).toBe(413);
  });
});
