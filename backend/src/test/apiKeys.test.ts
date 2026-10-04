import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { eq } from 'drizzle-orm';
import request from './request';
import { buildApp } from '../app';
import { db, pool } from '../db/client';
import { apiKeys, auditLogs, users } from '../db/schema';
import { createKey, withKey } from './integrationHelpers';
import { createIncident, resetDb, setupOrg, userIdOf, type TestOrg } from './helpers';

const app = buildApp();
let o: TestOrg;

afterAll(() => pool.end());
beforeEach(async () => {
  await resetDb();
  o = await setupOrg(app);
});

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('creating keys', () => {
  it('ADMIN+ creates a key; the secret is returned once and only its hash is stored', async () => {
    const key = await createKey(app, o.admin, { name: 'GitHub Actions' });
    expect(key.key).toMatch(/^ofk_[A-Za-z0-9_-]{43}$/);
    expect(key).toMatchObject({
      name: 'GitHub Actions',
      scopes: ['ingest', 'alerts'],
      serviceId: null,
      revokedAt: null,
      lastUsedAt: null,
    });
    expect(key.keyPrefix).toBe(key.key.slice(0, 10));
    expect(key.keyPrefix.length).toBeLessThan(key.key.length);

    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, key.id));
    expect(row!.keyHash).toBe(sha256(key.key));
    expect(JSON.stringify(row)).not.toContain(key.key); // the secret is nowhere in the database
    expect((await createKey(app, o.admin)).key).not.toBe(key.key); // every key is unique
  });

  it('only ADMIN and above can manage keys; keys cannot manage keys', async () => {
    const body = { name: 'x', scopes: ['ingest'] };
    for (const cookie of [o.engineer, o.viewer]) {
      expect(
        (await request(app).post('/api/api-keys').set('cookie', cookie).send(body)).status,
      ).toBe(403);
      expect((await request(app).get('/api/api-keys').set('cookie', cookie)).status).toBe(403);
    }
    expect((await request(app).post('/api/api-keys').send(body)).status).toBe(401);
    const key = await createKey(app, o.admin);
    expect((await withKey(app, key.key).get('/api/api-keys')).status).toBe(401); // a key is not a session
    expect((await withKey(app, key.key).post('/api/api-keys', body)).status).toBe(401);
  });

  it('validates the request and scopes everything to the organization', async () => {
    const post = (body: object) =>
      request(app).post('/api/api-keys').set('cookie', o.admin).send(body);
    expect((await post({ scopes: ['ingest'] })).status).toBe(400); // no name
    expect((await post({ name: 'x', scopes: [] })).status).toBe(400);
    expect((await post({ name: 'x', scopes: ['admin'] })).status).toBe(400);
    expect((await post({ name: '', scopes: ['ingest'] })).status).toBe(400);
    const other = await setupOrg(app, 'b');
    const foreign = await post({ name: 'x', scopes: ['ingest'], serviceId: other.serviceId });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.code).toBe('UNKNOWN_SERVICE');
  });

  it('records who created it in the audit log, and de-duplicates repeated scopes', async () => {
    const res = await request(app)
      .post('/api/api-keys')
      .set('cookie', o.admin)
      .send({ name: 'Dup', scopes: ['ingest', 'ingest'] });
    expect(res.body.key.scopes).toEqual(['ingest']);
    const audit = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, res.body.key.id));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'api_key.created' });
    expect(audit[0]!.metadata).toMatchObject({ name: 'Dup', keyPrefix: res.body.key.keyPrefix });
    expect(JSON.stringify(audit[0])).not.toContain(res.body.key.key);
  });
});

describe('listing and revoking', () => {
  it('lists keys without any secret, scoped to the organization', async () => {
    const mine = await createKey(app, o.admin, { name: 'Mine' });
    const other = await setupOrg(app, 'b');
    await createKey(app, other.admin, { name: 'Theirs' });
    const res = await request(app).get('/api/api-keys').set('cookie', o.owner);
    expect(res.body.keys.map((k: { name: string }) => k.name)).toEqual(['Mine']);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(mine.key);
    expect(text).not.toContain(sha256(mine.key));
    expect(res.body.keys[0]).not.toHaveProperty('key');
    expect(res.body.keys[0]).not.toHaveProperty('keyHash');
  });

  it('revoking stops the key immediately, is audited, cannot be repeated, and cannot touch another org', async () => {
    const key = await createKey(app, o.admin);
    const use = () =>
      withKey(app, key.key).post('/api/logs', { service: 'payment', level: 'INFO', message: 'hi' });
    expect((await use()).status).toBe(201);

    const other = await setupOrg(app, 'b');
    expect(
      (await request(app).delete(`/api/api-keys/${key.id}`).set('cookie', other.admin)).status,
    ).toBe(404);
    const revoked = await request(app).delete(`/api/api-keys/${key.id}`).set('cookie', o.admin);
    expect(revoked.status).toBe(200);
    expect(revoked.body.key.revokedAt).not.toBeNull();

    const after = await use();
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('INVALID_API_KEY');
    const again = await request(app).delete(`/api/api-keys/${key.id}`).set('cookie', o.admin);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_REVOKED');
    const audit = (await db.select().from(auditLogs).where(eq(auditLogs.resourceId, key.id)))
      .map((a) => a.action)
      .sort();
    expect(audit).toEqual(['api_key.created', 'api_key.revoked']);
    expect(
      (await request(app).delete('/api/api-keys/not-a-uuid').set('cookie', o.admin)).status,
    ).toBe(400);
  });
});

describe('authenticating with a key', () => {
  it('accepts logs, metrics and deployments, addressed by service slug, attributed to the key by name', async () => {
    const key = await createKey(app, o.admin, { name: 'payment-ci' });
    const k = withKey(app, key.key);
    expect(
      (await k.post('/api/logs', { service: 'payment', level: 'ERROR', message: 'boom' })).status,
    ).toBe(201);
    expect(
      (
        await k.post('/api/logs', {
          logs: [
            { service: 'payment', level: 'INFO', message: 'a' },
            { service: 'payment', level: 'WARN', message: 'b' },
          ],
        })
      ).body.inserted,
    ).toBe(2);
    expect(
      (
        await k.post('/api/metrics', {
          service: 'payment',
          errorRate: 0.4,
          latencyMs: 3000,
          requestsPerMin: 100,
        })
      ).status,
    ).toBe(201);
    const dep = await k.post('/api/deployments', {
      service: 'payment',
      version: 'v9.9.9',
      commitSha: 'abc1234',
    });
    expect(dep.status).toBe(201);
    expect(dep.body.deployment).toMatchObject({
      version: 'v9.9.9',
      deployedBy: 'payment-ci',
      serviceName: 'Payment Service',
    });

    // the data is real and visible to people
    expect((await request(app).get('/api/logs').set('cookie', o.viewer)).body.items).toHaveLength(
      3,
    );
    expect(
      (
        await request(app)
          .get(`/api/services/${o.serviceId}/metrics/latest`)
          .set('cookie', o.viewer)
      ).body.metric.errorRate,
    ).toBe(0.4);
    // and audited under the key's own service account, not under any person
    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'deployment.created'));
    const [actor] = await db.select().from(users).where(eq(users.id, audit!.actorId));
    expect(actor).toMatchObject({ name: 'payment-ci', isBot: true });
  });

  it('rejects missing, malformed, unknown and wrongly-schemed credentials with 401', async () => {
    const send = (headers: Record<string, string>) =>
      request(app)
        .post('/api/logs')
        .set(headers)
        .send({ service: 'payment', level: 'INFO', message: 'x' });
    expect((await send({})).status).toBe(401);
    for (const authorization of [
      'Bearer',
      'Bearer nonsense',
      `Bearer ofk_${'a'.repeat(43)}`,
      'Basic dXNlcjpwYXNz',
      'ofk_abc',
      `Bearer ofk_${'a'.repeat(42)}`,
    ]) {
      const res = await send({ authorization });
      expect(res.status, authorization).toBe(401);
      expect(res.body.error.code).toBe('INVALID_API_KEY');
      expect(res.body.error.message).not.toContain('aaaa');
    }
  });

  it('an invalid key does not fall back to a valid session cookie', async () => {
    const res = await request(app)
      .post('/api/logs')
      .set('cookie', o.engineer)
      .set('authorization', `Bearer ofk_${'b'.repeat(43)}`)
      .send({ service: 'payment', level: 'INFO', message: 'x' });
    expect(res.status).toBe(401);
  });

  it('people can still use the same endpoints with a session, including a slug', async () => {
    const res = await request(app)
      .post('/api/logs')
      .set('cookie', o.engineer)
      .send({ service: 'payment', level: 'INFO', message: 'by hand' });
    expect(res.status).toBe(201);
    expect(
      (
        await request(app)
          .post('/api/logs')
          .set('cookie', o.viewer)
          .send({ service: 'payment', level: 'INFO', message: 'x' })
      ).status,
    ).toBe(403);
  });

  it('records when a key was last used', async () => {
    const key = await createKey(app, o.admin);
    expect(
      (await request(app).get('/api/api-keys').set('cookie', o.admin)).body.keys[0].lastUsedAt,
    ).toBeNull();
    await withKey(app, key.key).post('/api/logs', {
      service: 'payment',
      level: 'INFO',
      message: 'x',
    });
    await new Promise((r) => setTimeout(r, 100));
    const listed = (await request(app).get('/api/api-keys').set('cookie', o.admin)).body.keys[0];
    expect(new Date(listed.lastUsedAt).getTime()).toBeGreaterThan(Date.now() - 10_000);
  });

  it('works without the CSRF header or a cookie (it is not a browser session), while cookie writes still need it', async () => {
    const key = await createKey(app, o.admin);
    const bare = supertest(app);
    const viaKey = await bare
      .post('/api/logs')
      .set('authorization', `Bearer ${key.key}`)
      .send({ service: 'payment', level: 'INFO', message: 'x' });
    expect(viaKey.status).toBe(201);
    const viaCookieNoHeader = await bare
      .post('/api/api-keys')
      .set('cookie', o.admin)
      .send({ name: 'x', scopes: ['ingest'] });
    expect(viaCookieNoHeader.status).toBe(403);
    expect(viaCookieNoHeader.body.error.code).toBe('CSRF_HEADER');
  });

  it('throttles repeated invalid attempts per IP: the 31st gets 429', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) {
      const res = await request(app)
        .post('/api/logs')
        .set('x-forwarded-for', '7.7.7.7')
        .set('authorization', `Bearer ofk_${String(i).padStart(43, 'c')}`)
        .send({});
      codes.push(res.status);
    }
    expect(codes.slice(0, 30).every((c) => c === 401)).toBe(true);
    expect(codes[30]).toBe(429);
    // another address is unaffected
    const other = await request(app)
      .post('/api/logs')
      .set('x-forwarded-for', '8.8.8.8')
      .set('authorization', `Bearer ofk_${'d'.repeat(43)}`)
      .send({});
    expect(other.status).toBe(401);
  });
});

describe('scopes and service restrictions', () => {
  it('a key can only do what its scopes allow', async () => {
    const alertsOnly = await createKey(app, o.admin, { scopes: ['alerts'] });
    const ingestOnly = await createKey(app, o.admin, { scopes: ['ingest'] });
    const denied = await withKey(app, alertsOnly.key).post('/api/logs', {
      service: 'payment',
      level: 'INFO',
      message: 'x',
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('KEY_SCOPE');
    const denied2 = await withKey(app, ingestOnly.key).post('/api/integrations/alerts', {
      service: 'payment',
      title: 'x',
    });
    expect(denied2.status).toBe(403);
    expect(denied2.body.error.code).toBe('KEY_SCOPE');
    expect(
      (
        await withKey(app, alertsOnly.key).post('/api/integrations/alerts', {
          service: 'payment',
          title: 'x',
        })
      ).status,
    ).toBe(201);
  });

  it('the alerts endpoints need a key; a signed-in session is not accepted there', async () => {
    const res = await request(app)
      .post('/api/integrations/alerts')
      .set('cookie', o.admin)
      .send({ service: 'payment', title: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('API_KEY_REQUIRED');
  });

  it('a key tied to one service can omit it, and can never act on another', async () => {
    const second = (
      await request(app)
        .post('/api/services')
        .set('cookie', o.admin)
        .send({ projectId: o.projectId, name: 'Auth', slug: 'auth' })
    ).body.service.id;
    const key = await createKey(app, o.admin, { serviceId: o.serviceId });
    const k = withKey(app, key.key);
    expect((await k.post('/api/logs', { level: 'INFO', message: 'no service given' })).status).toBe(
      201,
    ); // defaults to the bound service
    expect(
      (
        await k.post('/api/logs', {
          logs: [
            { level: 'INFO', message: 'a' },
            { service: 'payment', level: 'INFO', message: 'b' },
          ],
        })
      ).status,
    ).toBe(201);
    expect(
      (await request(app).get(`/api/logs?serviceId=${o.serviceId}`).set('cookie', o.viewer)).body
        .items,
    ).toHaveLength(3);

    for (const body of [
      { service: 'auth', level: 'INFO', message: 'x' },
      { serviceId: second, level: 'INFO', message: 'x' },
    ]) {
      const res = await k.post('/api/logs', body);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('KEY_SERVICE_MISMATCH');
    }
    const mixed = await k.post('/api/logs', {
      logs: [
        { level: 'INFO', message: 'ok' },
        { service: 'auth', level: 'INFO', message: 'bad' },
      ],
    });
    expect(mixed.status).toBe(403);
    expect(
      (await request(app).get(`/api/logs?serviceId=${o.serviceId}`).set('cookie', o.viewer)).body
        .items,
    ).toHaveLength(3); // nothing from the rejected batch
    expect((await k.post('/api/deployments', { version: 'v1', commitSha: 'abc1234' })).status).toBe(
      201,
    );
    expect(
      (await k.post('/api/metrics', { errorRate: 0.1, latencyMs: 100, requestsPerMin: 1 })).status,
    ).toBe(201);
  });

  it('a slug that exists only in another organization is not found, never resolved across tenants', async () => {
    const other = await setupOrg(app, 'b');
    await request(app)
      .post('/api/services')
      .set('cookie', other.admin)
      .send({ projectId: other.projectId, name: 'Secret', slug: 'secret-service' });
    const key = await createKey(app, o.admin);
    const res = await withKey(app, key.key).post('/api/logs', {
      service: 'secret-service',
      level: 'INFO',
      message: 'x',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNKNOWN_SERVICE');
    const foreignId = await withKey(app, key.key).post('/api/logs', {
      serviceId: other.serviceId,
      level: 'INFO',
      message: 'x',
    });
    expect(foreignId.status).toBe(400);
  });

  it('an unknown slug fails the whole batch cleanly', async () => {
    const key = await createKey(app, o.admin);
    const res = await withKey(app, key.key).post('/api/logs', {
      logs: [
        { service: 'payment', level: 'INFO', message: 'ok' },
        { service: 'nope', level: 'INFO', message: 'x' },
      ],
    });
    expect(res.status).toBe(400);
    expect((await request(app).get('/api/logs').set('cookie', o.viewer)).body.items).toHaveLength(
      0,
    );
  });
});

describe('service accounts are invisible and powerless as people', () => {
  it('never appear as members, cannot be assigned, added, signed in as, or notified', async () => {
    const key = await createKey(app, o.admin, { name: 'secret-bot' });
    const [bot] = await db.select().from(users).where(eq(users.name, 'secret-bot'));
    expect(bot!.isBot).toBe(true);

    const members = (await request(app).get('/api/members').set('cookie', o.viewer)).body
      .members as { name: string }[];
    expect(members.some((m) => m.name === 'secret-bot')).toBe(false);

    const incident = await createIncident(app, o.engineer, o.serviceId);
    const assign = await request(app)
      .patch(`/api/incidents/${incident.id}/assignee`)
      .set('cookie', o.engineer)
      .send({ version: 1, assigneeId: bot!.id });
    expect(assign.status).toBe(400);
    expect(assign.body.error.code).toBe('INVALID_ASSIGNEE');

    const add = await request(app)
      .post('/api/members')
      .set('cookie', o.admin)
      .send({ email: bot!.email, role: 'VIEWER' });
    expect(add.status).toBe(404);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: bot!.email, password: 'anything-at-all' });
    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe('INVALID_CREDENTIALS');
    void key;
    void userIdOf;
  });
});
