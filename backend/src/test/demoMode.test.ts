import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Worker } from 'bullmq';
import request from './request';
import { buildApp } from '../app';
import { db, pool } from '../db/client';
import { aiAnalyses, notifications, organizations } from '../db/schema';
import { DEMO_ORG_NAME, seed } from '../db/seed';
import { config } from '../lib/config';
import { ensureDemoData, scheduleDemoReset } from '../modules/demo/lifecycle';
import { startWorkers } from '../workers';
import { closeAll, incidentWithEvidence, resetQueues } from './aiHelpers';
import { cookieFrom, createIncident, resetDb, setupOrg, sleep, userIdOf, waitFor } from './helpers';

const app = buildApp();
const workers: Worker[] = [];

afterAll(() => pool.end());
beforeEach(async () => {
  await resetQueues();
  await resetDb();
  config.DEMO_MODE = true;
});
afterEach(async () => {
  config.DEMO_MODE = false;
  config.AI_DAILY_CAP = 200;
  await closeAll(workers);
});

const demoOrgId = async () =>
  (await db.select().from(organizations).where(eq(organizations.name, DEMO_ORG_NAME)))[0]?.id;

async function signInToDemo() {
  const res = await request(app).post('/api/demo/session');
  expect(res.status).toBe(200);
  return cookieFrom(res);
}

describe('the one-click demo session', () => {
  it('is off by default: the status says so and the session endpoint does not exist', async () => {
    config.DEMO_MODE = false;
    expect((await request(app).get('/api/demo/status')).body).toMatchObject({ enabled: false });
    const res = await request(app).post('/api/demo/session');
    expect(res.status).toBe(404);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('when enabled, anyone can ask whether the demo is available, without signing in', async () => {
    const res = await request(app).get('/api/demo/status');
    expect(res.body).toEqual({ enabled: true, resetHours: config.DEMO_RESET_HOURS });
  });

  it('reports "not ready" until the demo data exists, then signs the visitor in with no password', async () => {
    const early = await request(app).post('/api/demo/session');
    expect(early.status).toBe(503);
    expect(early.body.error.code).toBe('DEMO_NOT_READY');

    await seed();
    const cookie = await signInToDemo();
    const me = await request(app).get('/api/auth/me').set('cookie', cookie);
    expect(me.body).toMatchObject({
      role: 'ADMIN',
      demo: true,
      organization: { name: DEMO_ORG_NAME },
    });
    expect(me.body.user.email).toBe('demo-admin@opsflow.demo');
    expect((await request(app).get('/api/incidents').set('cookie', cookie)).status).toBe(200);
  });

  it('is rate limited per IP', async () => {
    await seed();
    const codes: number[] = [];
    for (let i = 0; i < 21; i++)
      codes.push(
        (await request(app).post('/api/demo/session').set('x-forwarded-for', '5.5.5.5')).status,
      );
    expect(codes.slice(0, 20).every((c) => c === 200)).toBe(true);
    expect(codes[20]).toBe(429);
  });
});

describe('what a demo visitor can and cannot do', () => {
  it('can do the incident work the demo is for: simulate, open, comment, move status, analyze', async () => {
    await seed();
    const cookie = await signInToDemo();
    const sim = await request(app).post('/api/demo/simulate-incident').set('cookie', cookie);
    expect(sim.status).toBe(201);
    const id = sim.body.incident.id as string;
    const comment = await request(app)
      .post(`/api/incidents/${id}/comments`)
      .set('cookie', cookie)
      .send({ body: 'Looking at it' });
    expect(comment.status).toBe(201);
    const status = await request(app)
      .patch(`/api/incidents/${id}/status`)
      .set('cookie', cookie)
      .send({ version: sim.body.incident.version, status: 'INVESTIGATING' });
    expect(status.status).toBe(200);
    expect(
      (await request(app).post(`/api/incidents/${id}/ai-analysis`).set('cookie', cookie)).status,
    ).toBe(202);
    const created = await request(app).post('/api/incidents').set('cookie', cookie).send({
      serviceId: sim.body.incident.serviceId,
      title: 'Visitor incident',
      severity: 'SEV3',
    });
    expect(created.status).toBe(201);
  });

  it('cannot change configuration: keys, members, runbooks, projects, services', async () => {
    await seed();
    const cookie = await signInToDemo();
    const me = await request(app).get('/api/auth/me').set('cookie', cookie);
    const services = (await request(app).get('/api/services').set('cookie', cookie)).body.items as {
      id: string;
      projectId: string;
    }[];
    const members = (await request(app).get('/api/members').set('cookie', cookie)).body.members as {
      id: string;
    }[];
    const blocked: [string, Promise<{ status: number; body: { error: { code: string } } }>][] = [
      [
        'create key',
        request(app)
          .post('/api/api-keys')
          .set('cookie', cookie)
          .send({ name: 'x', scopes: ['ingest'] }),
      ],
      [
        'revoke key',
        request(app)
          .delete('/api/api-keys/00000000-0000-4000-8000-000000000000')
          .set('cookie', cookie),
      ],
      [
        'add member',
        request(app)
          .post('/api/members')
          .set('cookie', cookie)
          .send({ email: 'someone@example.com', role: 'VIEWER' }),
      ],
      [
        'change role',
        request(app)
          .patch(`/api/members/${members[0]!.id}`)
          .set('cookie', cookie)
          .send({ role: 'VIEWER' }),
      ],
      [
        'create runbook',
        request(app).post('/api/runbooks').set('cookie', cookie).send({ title: 'x', content: 'y' }),
      ],
      ['reindex all', request(app).post('/api/runbooks/reindex-all').set('cookie', cookie)],
      [
        'create project',
        request(app).post('/api/projects').set('cookie', cookie).send({ name: 'x', slug: 'x' }),
      ],
      [
        'create service',
        request(app)
          .post('/api/services')
          .set('cookie', cookie)
          .send({ projectId: services[0]!.projectId, name: 'x', slug: 'x' }),
      ],
      [
        'change service',
        request(app)
          .patch(`/api/services/${services[0]!.id}`)
          .set('cookie', cookie)
          .send({ status: 'DOWN' }),
      ],
    ];
    for (const [name, pending] of blocked) {
      const res = await pending;
      expect(res.status, name).toBe(403);
      expect(res.body.error.code, name).toBe('DEMO_READONLY');
    }
    expect(me.body.demo).toBe(true);
    // reading is fine
    expect((await request(app).get('/api/api-keys').set('cookie', cookie)).status).toBe(200);
  });

  it('does not restrict real accounts, even while the server is in demo mode', async () => {
    const o = await setupOrg(app);
    expect(
      (
        await request(app)
          .post('/api/api-keys')
          .set('cookie', o.admin)
          .send({ name: 'real', scopes: ['ingest'] })
      ).status,
    ).toBe(201);
    expect(
      (
        await request(app)
          .post('/api/runbooks')
          .set('cookie', o.admin)
          .send({ title: 'x', content: 'y' })
      ).status,
    ).toBe(201);
    expect(
      (
        await request(app)
          .post('/api/projects')
          .set('cookie', o.admin)
          .send({ name: 'Another', slug: 'another' })
      ).status,
    ).toBe(201);
    const me = await request(app).get('/api/auth/me').set('cookie', o.admin);
    expect(me.body.demo).toBeUndefined();
  });

  it('does not treat demo-looking accounts specially when demo mode is off', async () => {
    await seed();
    config.DEMO_MODE = false;
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'demo-admin@opsflow.demo', password: 'demo-password-1' });
    const cookie = cookieFrom(login);
    expect(
      (await request(app).get('/api/auth/me').set('cookie', cookie)).body.demo,
    ).toBeUndefined();
    expect(
      (
        await request(app)
          .post('/api/api-keys')
          .set('cookie', cookie)
          .send({ name: 'x', scopes: ['ingest'] })
      ).status,
    ).toBe(201);
  });
});

describe('demo data lifecycle', () => {
  it('prepares the demo on first boot and leaves an existing one alone', async () => {
    expect(await demoOrgId()).toBeUndefined();
    await ensureDemoData();
    const first = await demoOrgId();
    expect(first).toBeDefined();
    await ensureDemoData();
    expect(await demoOrgId()).toBe(first); // not re-created
  });

  it('rebuilds the demo on a schedule, and can be switched off', async () => {
    await seed();
    const before = await demoOrgId();
    const stop = scheduleDemoReset(0.00002); // about 70 ms
    await waitFor(async () => {
      const now = await demoOrgId();
      return now && now !== before ? now : null;
    }, 8000);
    stop();
    const after = await demoOrgId();
    await sleep(400);
    expect(await demoOrgId()).toBe(after); // stopped: no further resets
    expect(scheduleDemoReset(0)()).toBeUndefined(); // 0 hours means never
  }, 30_000);
});

describe('daily AI analysis cap', () => {
  const start = (cookie: string, id: string) =>
    request(app).post(`/api/incidents/${id}/ai-analysis`).set('cookie', cookie).send({});
  const finishAll = () =>
    db.update(aiAnalyses).set({ status: 'COMPLETED', completedAt: new Date() });

  it('stops new analyses once an organization reaches the limit, with a clear error', async () => {
    config.DEMO_MODE = false;
    const o = await setupOrg(app);
    const inc = await incidentWithEvidence(app, o);
    config.AI_DAILY_CAP = 2;
    expect((await start(o.engineer, inc.id)).status).toBe(202);
    await finishAll();
    expect((await start(o.engineer, inc.id)).status).toBe(202);
    await finishAll();
    const blocked = await start(o.engineer, inc.id);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('AI_DAILY_CAP');
    expect(blocked.body.error.message).toContain('2 AI analyses per day');
  });

  it('never blocks re-clicking an analysis that is already running, even at the limit', async () => {
    config.DEMO_MODE = false;
    const o = await setupOrg(app);
    const inc = await incidentWithEvidence(app, o);
    config.AI_DAILY_CAP = 1;
    const first = await start(o.engineer, inc.id);
    const again = await start(o.engineer, inc.id);
    expect(again.status).toBe(202);
    expect(again.body).toMatchObject({ analysisId: first.body.analysisId, existing: true });
  });

  it('counts per organization, ages out after 24 hours, and 0 means no limit', async () => {
    config.DEMO_MODE = false;
    const a = await setupOrg(app, 'a');
    const b = await setupOrg(app, 'b');
    const incA = await incidentWithEvidence(app, a);
    const incB = await incidentWithEvidence(app, b);
    config.AI_DAILY_CAP = 1;
    await start(a.engineer, incA.id);
    await finishAll();
    expect((await start(a.engineer, incA.id)).status).toBe(429);
    expect((await start(b.engineer, incB.id)).status).toBe(202); // another organization has its own allowance

    await db.update(aiAnalyses).set({ createdAt: new Date(Date.now() - 25 * 3_600_000) });
    expect((await start(a.engineer, incA.id)).status).toBe(202); // old runs no longer count
    await finishAll();
    config.AI_DAILY_CAP = 0;
    expect((await start(a.engineer, incA.id)).status).toBe(202);
  });
});

describe('embedded workers (one-process mode)', () => {
  it('starts the three workers and processes events, so notifications still arrive', async () => {
    config.DEMO_MODE = false;
    const o = await setupOrg(app);
    const started = startWorkers();
    workers.push(...started);
    expect(started.map((w) => w.name).sort()).toEqual([
      'ai-analysis',
      'incident-events',
      'runbook-indexing',
    ]);
    await Promise.all(started.map((w) => w.waitUntilReady()));

    const engineerId = await userIdOf(app, o.engineer);
    await createIncident(app, o.admin, o.serviceId, { assigneeId: engineerId });
    const rows = await waitFor(async () => {
      const r = await db.select().from(notifications).where(eq(notifications.userId, engineerId));
      return r.length ? r : null;
    });
    expect(rows[0]!.payload.message).toMatch(/^New SEV\d incident/);
  });
});
