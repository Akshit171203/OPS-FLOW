import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import request from './request';
import { buildApp } from '../app';
import { pool } from '../db/client';
import { config } from '../lib/config';
import { authCookieOptions } from '../middleware/auth';
import { register, resetDb, setupOrg, type TestOrg } from './helpers';

const app = buildApp();
const raw = supertest(app); // no CSRF header: for tests that must send requests the way an attacker would
const WEB = config.WEB_ORIGIN;
const EVIL = 'https://evil.example';

afterAll(() => pool.end());
beforeEach(resetDb);

describe('CORS', () => {
  it('answers the web origin with credentials allowed', async () => {
    const res = await raw
      .options('/api/incidents')
      .set('origin', WEB)
      .set('access-control-request-method', 'POST')
      .set('access-control-request-headers', 'content-type,x-requested-with');
    expect(res.headers['access-control-allow-origin']).toBe(WEB);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-headers']).toMatch(/x-requested-with/i);
  });

  it('gives an unknown origin no CORS headers at all, on preflight and on real requests', async () => {
    const pre = await raw
      .options('/api/incidents')
      .set('origin', EVIL)
      .set('access-control-request-method', 'POST');
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();
    expect(pre.headers['access-control-allow-credentials']).toBeUndefined();

    const real = await raw.get('/health').set('origin', EVIL);
    expect(real.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('CSRF protection on cookie-authenticated writes', () => {
  let o: TestOrg;
  beforeEach(async () => {
    o = await setupOrg(app);
  });
  const incident = (o: TestOrg) => ({ serviceId: o.serviceId, title: 'x', severity: 'SEV3' });

  it('rejects a write that carries the session cookie but not the custom header', async () => {
    const res = await raw.post('/api/incidents').set('cookie', o.engineer).send(incident(o));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_HEADER');
  });

  it('applies to PATCH and DELETE-style methods too', async () => {
    const res = await raw
      .patch(`/api/services/${o.serviceId}`)
      .set('cookie', o.admin)
      .send({ status: 'DOWN' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_HEADER');
  });

  it('accepts the same write with the header, with no Origin or with our origin', async () => {
    expect(
      (await request(app).post('/api/incidents').set('cookie', o.engineer).send(incident(o)))
        .status,
    ).toBe(201);
    const withOrigin = await request(app)
      .post('/api/incidents')
      .set('cookie', o.engineer)
      .set('origin', WEB)
      .send(incident(o));
    expect(withOrigin.status).toBe(201);
  });

  it('rejects a cross-origin write even when the header is present', async () => {
    const res = await request(app)
      .post('/api/incidents')
      .set('cookie', o.engineer)
      .set('origin', EVIL)
      .send(incident(o));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_ORIGIN');
  });

  it('rejects a cross-origin login attempt (no cookie needed to be forged)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('origin', EVIL)
      .send({ email: 'a@b.co', password: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_ORIGIN');
  });

  it('does not affect reads, or unauthenticated writes such as register and login', async () => {
    expect((await raw.get('/api/incidents').set('cookie', o.viewer)).status).toBe(200);
    const reg = await raw.post('/api/auth/register').send({
      email: 'new@example.com',
      password: 'correct-horse-battery',
      name: 'N',
      organizationName: 'N',
    });
    expect(reg.status).toBe(201);
    expect(
      (
        await raw
          .post('/api/auth/login')
          .send({ email: 'new@example.com', password: 'correct-horse-battery' })
      ).status,
    ).toBe(200);
  });

  it('a wrong header value is as bad as a missing one', async () => {
    const res = await raw
      .post('/api/incidents')
      .set('cookie', o.engineer)
      .set('x-requested-with', 'XMLHttpRequest')
      .send(incident(o));
    expect(res.status).toBe(403);
  });
});

describe('request size limits', () => {
  it('rejects bodies over 100kb on ordinary endpoints with 413', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@b.co', password: 'x'.repeat(150 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('allows up to 1mb on log ingestion, and rejects more with 413', async () => {
    const o = await setupOrg(app);
    const entry = (msg: string) => ({ serviceId: o.serviceId, level: 'INFO', message: msg });
    const big = { logs: Array.from({ length: 300 }, () => entry('y'.repeat(1200))) }; // ~370kb
    expect((await request(app).post('/api/logs').set('cookie', o.engineer).send(big)).status).toBe(
      201,
    );
    const huge = { logs: Array.from({ length: 300 }, () => entry('y'.repeat(4900))) }; // ~1.5mb
    const res = await request(app).post('/api/logs').set('cookie', o.engineer).send(huge);
    expect(res.status).toBe(413);
  });
});

describe('response headers', () => {
  it('sets a strict CSP, nosniff, no-referrer, same-site resource policy and no-store, and hides the framework', async () => {
    const res = await raw.get('/health');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-site');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('error responses are no-store too', async () => {
    const res = await raw.get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('session cookie flags per environment', () => {
  it('production: Secure, HttpOnly, SameSite and Domain from configuration', () => {
    expect(
      authCookieOptions({ secure: true, sameSite: 'strict', domain: '.opsflow.example' }),
    ).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      domain: '.opsflow.example',
    });
  });

  it('development: not Secure so it works on http://localhost, still HttpOnly and SameSite=Lax', () => {
    expect(authCookieOptions({ secure: false, sameSite: 'lax' })).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    });
  });

  it('the cookie actually sent carries HttpOnly, SameSite and Path; logout clears with the same attributes', async () => {
    const { res } = await register(app);
    const set = String(res.headers['set-cookie']);
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Lax/i);
    expect(set).toMatch(/Path=\//);
    const out = await request(app).post('/api/auth/logout');
    expect(String(out.headers['set-cookie'])).toMatch(/opsflow_token=;.*Path=\//);
  });
});
