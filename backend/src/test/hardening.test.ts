import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from './request';
import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { passwordProblem } from '@opsflow/shared';
import { buildApp } from '../app';
import { db, pool } from '../db/client';
import { organizationMembers, organizations, revokedSessions, users } from '../db/schema';
import { config } from '../lib/config';
import { authenticateToken, signToken } from '../middleware/auth';
import { cookieFrom, register, resetDb } from './helpers';

const app = buildApp();

afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await resetDb();
});

const login = (email: string, password: string) =>
  request(app).post('/api/auth/login').send({ email, password });
const me = (cookie: string) => request(app).get('/api/auth/me').set('cookie', cookie);
const logout = (cookie?: string) => {
  const r = request(app).post('/api/auth/logout');
  return cookie ? r.set('cookie', cookie) : r;
};

describe('signing out revokes the session token, not just the cookie', () => {
  it('a signed-out token is refused even though it is still correctly signed and unexpired', async () => {
    const { payload } = await register(app);
    const session = cookieFrom(await login(payload.email, payload.password));
    expect((await me(session)).status).toBe(200);

    expect((await logout(session)).status).toBe(204);

    // a copy of the cookie someone kept (a leak, a log line, a second device that never cleared it)
    const replay = await me(session);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('UNAUTHORIZED');
  });

  it('only that session ends: the same user signed in elsewhere stays signed in', async () => {
    // matters for the public demo, where every visitor shares one account
    const { payload } = await register(app);
    const a = cookieFrom(await login(payload.email, payload.password));
    const b = cookieFrom(await login(payload.email, payload.password));
    expect(a).not.toBe(b);

    await logout(a);

    expect((await me(a)).status).toBe(401);
    expect((await me(b)).status).toBe(200);
  });

  it('every token carries its own unique id', async () => {
    const { payload } = await register(app);
    const tokens = await Promise.all(
      [1, 2, 3].map(async () => cookieFrom(await login(payload.email, payload.password))),
    );
    const ids = tokens.map((t) => (jwt.decode(t.split('=')[1]!) as jwt.JwtPayload).jti);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(3);
  });

  it('records the id until the token would have expired, and signing out twice is harmless', async () => {
    const { payload } = await register(app);
    const session = cookieFrom(await login(payload.email, payload.password));
    const decoded = jwt.decode(session.split('=')[1]!) as jwt.JwtPayload;

    await logout(session);
    await logout(session);

    const rows = await db.select().from(revokedSessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.jti).toBe(decoded.jti);
    expect(rows[0]!.expiresAt.getTime()).toBe(decoded.exp! * 1000);
  });

  it('forgets entries whose token has expired anyway', async () => {
    await db.insert(revokedSessions).values({
      jti: '11111111-1111-4111-8111-111111111111',
      expiresAt: new Date(Date.now() - 1000),
    });
    const { payload } = await register(app);
    await logout(cookieFrom(await login(payload.email, payload.password)));

    const rows = await db.select().from(revokedSessions);
    expect(rows.map((r) => r.jti)).not.toContain('11111111-1111-4111-8111-111111111111');
    expect(rows).toHaveLength(1);
  });

  it('signing out with no cookie or a garbage one still succeeds and clears the cookie', async () => {
    for (const res of [await logout(), await logout('opsflow_token=garbage')]) {
      expect(res.status).toBe(204);
      expect(String(res.headers['set-cookie'])).toMatch(/opsflow_token=;/);
    }
    expect(await db.select().from(revokedSessions)).toHaveLength(0);
  });

  it('the realtime socket handshake uses the same check, so a revoked token cannot connect', async () => {
    const { payload } = await register(app);
    const session = cookieFrom(await login(payload.email, payload.password));
    const token = session.split('=')[1]!;
    await expect(authenticateToken(token)).resolves.toMatchObject({ email: payload.email });

    await logout(session);

    await expect(authenticateToken(token)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('a token from before ids existed has nothing to revoke and keeps working until it expires', async () => {
    const { payload } = await register(app);
    const [user] = await db.select().from(users).where(eq(users.email, payload.email));
    const [member] = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, user!.id));
    const legacy = jwt.sign({ org: member!.organizationId }, config.JWT_SECRET, {
      subject: user!.id,
      expiresIn: '1h',
    });
    expect((await me(`opsflow_token=${legacy}`)).status).toBe(200);
    expect((await logout(`opsflow_token=${legacy}`)).status).toBe(204);
    expect(await db.select().from(revokedSessions)).toHaveLength(0);
  });

  it('a freshly signed token for a real member is accepted (sanity)', async () => {
    const { payload } = await register(app);
    const [user] = await db.select().from(users).where(eq(users.email, payload.email));
    const [org] = await db.select().from(organizations);
    await expect(authenticateToken(signToken(user!.id, org!.id))).resolves.toMatchObject({
      role: 'OWNER',
    });
  });
});

describe('password policy for new accounts', () => {
  it.each([
    'password',
    'Password1',
    'password123!',
    'PASSWORD123',
    'Qwerty123',
    'iloveyou',
    '12345678',
    '1234567890',
    '11111111',
    'aaaaaaaa',
    'Welcome@123',
    'P@ssw0rd',
    'opsflow123',
  ])('rejects the common password %s', async (password) => {
    const { res } = await register(app, { password });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.error.details)).toContain('too common');
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it('rejects a password built from the email or the name', async () => {
    const byEmail = await register(app, {
      email: 'jessica.parker@example.com',
      password: 'jessica.parker-2026',
    });
    expect(byEmail.res.status).toBe(400);
    expect(JSON.stringify(byEmail.res.body.error.details)).toContain('name or email');

    const byName = await register(app, {
      email: 'x@example.com',
      name: 'Olivia Harrington',
      password: 'harrington-rocks-99',
    });
    expect(byName.res.status).toBe(400);

    const sameAsEmail = await register(app, {
      email: 'owner@example.com',
      password: 'owner@example.com',
    });
    expect(sameAsEmail.res.status).toBe(400);
  });

  it('accepts a long, unrelated passphrase', async () => {
    for (const password of ['correct-horse-battery', 'violet-lantern-orbit-42', 'x9!kQ2#mWz7v']) {
      const { res } = await register(app, { email: `u${password.length}@example.com`, password });
      expect(res.status).toBe(201);
    }
  });

  it('short names and local parts do not cause false rejections', () => {
    expect(
      passwordProblem('amber-kettle-tundra', { email: 'al@example.com', name: 'Al Li' }),
    ).toBeNull();
  });

  it('sign-in is not affected: an existing account with a weak password can still log in', async () => {
    // accounts created before the policy must keep working; only NEW passwords are checked
    const [user] = await db
      .insert(users)
      .values({
        email: 'old@example.com',
        passwordHash: await argon2.hash('password'),
        name: 'Old',
      })
      .returning();
    const [org] = await db.insert(organizations).values({ name: 'Old Co' }).returning();
    await db
      .insert(organizationMembers)
      .values({ organizationId: org!.id, userId: user!.id, role: 'OWNER' });

    const res = await login('old@example.com', 'password');
    expect(res.status).toBe(200);
  });
});

describe('registration cannot be used to enumerate emails quickly', () => {
  it('limits attempts per email address, however many IPs they come from', async () => {
    const { payload } = await register(app, { email: 'victim@example.com' });
    // second and third attempts get the normal "already registered" answer
    for (let i = 0; i < 2; i++) {
      const again = await register(app, { email: payload.email });
      expect(again.res.status).toBe(409);
    }
    const blocked = await register(app, { email: payload.email });
    expect(blocked.res.status).toBe(429);
    expect(blocked.res.headers['retry-after']).toBeDefined();
  });

  it('a different address is unaffected by that limit', async () => {
    for (let i = 0; i < 4; i++) await register(app, { email: 'busy@example.com' });
    const other = await register(app, { email: 'someone-else@example.com' });
    expect(other.res.status).toBe(201);
  });

  it('upper and lower case of the same address share one allowance', async () => {
    await register(app, { email: 'case@example.com' });
    await register(app, { email: 'CASE@example.com' });
    await register(app, { email: 'Case@Example.com' });
    const fourth = await register(app, { email: ' case@example.com ' });
    expect(fourth.res.status).toBe(429);
  });
});
