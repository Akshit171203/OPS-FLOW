import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { eq, sql } from 'drizzle-orm';
import { buildApp } from '../app';
import { db, pool } from '../db/client';
import { auditLogs, incidentEvents, incidents } from '../db/schema';
import { auditRepository } from '../modules/audit/repository';
import { createIncident, resetDb, setupOrg, type TestOrg } from './helpers';

const app = buildApp();
let o: TestOrg;

afterAll(() => pool.end());
beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDb();
  o = await setupOrg(app);
});

const as = (cookie: string) => ({
  get: (url: string) => request(app).get(url).set('cookie', cookie),
  post: (url: string, body: object) => request(app).post(url).set('cookie', cookie).send(body),
  patch: (url: string, body: object) => request(app).patch(url).set('cookie', cookie).send(body),
});

describe('permissions', () => {
  it('VIEWER can read but not write; ENGINEER can create', async () => {
    const created = await createIncident(app, o.engineer, o.serviceId);
    const v = as(o.viewer);
    expect((await v.get('/api/incidents')).status).toBe(200);
    expect((await v.get(`/api/incidents/${created.id}`)).status).toBe(200);
    const denied = await v.post('/api/incidents', {
      serviceId: o.serviceId,
      title: 'x',
      severity: 'SEV1',
    });
    expect(denied.status).toBe(403);
    expect((await v.post(`/api/incidents/${created.id}/comments`, { body: 'hi' })).status).toBe(
      403,
    );
    expect(
      (
        await v.patch(`/api/incidents/${created.id}/status`, {
          version: 1,
          status: 'INVESTIGATING',
        })
      ).status,
    ).toBe(403);
  });
});

describe('atomicity and audit trail', () => {
  it('create rolls back fully if the audit log insert fails', async () => {
    vi.spyOn(auditRepository, 'insert').mockRejectedValueOnce(new Error('audit down'));
    const res = await as(o.engineer).post('/api/incidents', {
      serviceId: o.serviceId,
      title: 'Will not exist',
      severity: 'SEV1',
    });
    expect(res.status).toBe(500);
    expect(await db.select().from(incidents)).toHaveLength(0);
    expect(await db.select().from(incidentEvents)).toHaveLength(0);
  });

  it('every change appears in both the timeline and the audit log', async () => {
    const e = as(o.engineer);
    const { id } = await createIncident(app, o.engineer, o.serviceId);
    await e.patch(`/api/incidents/${id}`, { version: 1, title: 'Renamed' });
    await e.patch(`/api/incidents/${id}/assignee`, { version: 2, assigneeId: null });
    await e.patch(`/api/incidents/${id}/status`, { version: 3, status: 'INVESTIGATING' });
    await e.post(`/api/incidents/${id}/comments`, { body: 'Looking now' });

    const expected = [
      'incident.created',
      'incident.updated',
      'incident.assigned',
      'incident.status_changed',
      'incident.comment_added',
    ];
    const detail = await e.get(`/api/incidents/${id}`);
    expect(detail.body.events.map((x: { eventType: string }) => x.eventType)).toEqual(expected);
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.resourceId, id));
    expect(audit.map((a) => a.action).sort()).toEqual([...expected].sort());
    expect(audit.every((a) => a.ipAddress && a.actorId && a.organizationId)).toBe(true);
    expect(detail.body.comments[0]).toMatchObject({
      body: 'Looking now',
      author: { name: expect.any(String) },
    });
  });
});

describe('lifecycle', () => {
  it('walks OPEN -> CLOSED, setting resolved_at on RESOLVED only', async () => {
    const e = as(o.engineer);
    const { id } = await createIncident(app, o.engineer, o.serviceId);
    let version = 1;
    const step = async (status: string) => {
      const res = await e.patch(`/api/incidents/${id}/status`, { version, status });
      expect(res.status).toBe(200);
      version = res.body.incident.version;
      return res.body.incident;
    };
    expect((await step('INVESTIGATING')).resolvedAt).toBeNull();
    expect((await step('MITIGATING')).resolvedAt).toBeNull();
    const resolved = await step('RESOLVED');
    expect(resolved.resolvedAt).not.toBeNull();
    expect(resolved.allowedNextStatuses).toEqual(['CLOSED']);
    const closed = await step('CLOSED');
    expect(closed.resolvedAt).toBe(resolved.resolvedAt);
    expect(closed.allowedNextStatuses).toEqual([]);
  });

  it('the database CHECK blocks resolved_at on an open incident', async () => {
    const { id } = await createIncident(app, o.engineer, o.serviceId);
    await expect(
      db.execute(sql`UPDATE incidents SET resolved_at = now() WHERE id = ${id}`),
    ).rejects.toThrow();
  });
});

describe('concurrency and transitions', () => {
  it('two updates with the same version: first wins, second gets 409 VERSION_CONFLICT', async () => {
    const e = as(o.engineer);
    const { id } = await createIncident(app, o.engineer, o.serviceId);
    const first = await e.patch(`/api/incidents/${id}`, { version: 1, title: 'First' });
    const second = await e.patch(`/api/incidents/${id}`, { version: 1, title: 'Second' });
    expect(first.status).toBe(200);
    expect(first.body.incident.version).toBe(2);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('VERSION_CONFLICT');
    expect(second.body.error.details.currentVersion).toBe(2);
    expect((await e.get(`/api/incidents/${id}`)).body.incident.title).toBe('First');
  });

  it('truly simultaneous updates: exactly one succeeds', async () => {
    const { id } = await createIncident(app, o.engineer, o.serviceId);
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        as(o.engineer).patch(`/api/incidents/${id}`, { version: 1, title: `Racer ${i}` }),
      ),
    );
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([200, 409, 409, 409, 409]);
    const events = await db.select().from(incidentEvents).where(eq(incidentEvents.incidentId, id));
    expect(events.filter((x) => x.eventType === 'incident.updated')).toHaveLength(1);
  });

  it('invalid transition and stale version return distinct 409 codes', async () => {
    const e = as(o.engineer);
    const { id } = await createIncident(app, o.engineer, o.serviceId);

    const invalid = await e.patch(`/api/incidents/${id}/status`, {
      version: 1,
      status: 'RESOLVED',
    });
    expect(invalid.status).toBe(409);
    expect(invalid.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    expect(invalid.body.error.details.allowed).toEqual(['INVESTIGATING']);

    await e.patch(`/api/incidents/${id}`, { version: 1, title: 'Bump' });
    const stale = await e.patch(`/api/incidents/${id}/status`, {
      version: 1,
      status: 'INVESTIGATING',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');

    const staleAndInvalid = await e.patch(`/api/incidents/${id}/status`, {
      version: 1,
      status: 'CLOSED',
    });
    expect(staleAndInvalid.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('a failed transition changes nothing', async () => {
    const { id } = await createIncident(app, o.engineer, o.serviceId);
    await as(o.engineer).patch(`/api/incidents/${id}/status`, { version: 1, status: 'CLOSED' });
    const [row] = await db.select().from(incidents).where(eq(incidents.id, id));
    expect(row).toMatchObject({ status: 'OPEN', version: 1 });
    expect(await db.select().from(incidentEvents)).toHaveLength(1);
  });
});

describe('tenant isolation', () => {
  it("another organization's incident is 404 everywhere and absent from lists", async () => {
    const other = await setupOrg(app, 'b');
    const { id } = await createIncident(app, o.engineer, o.serviceId);
    const x = as(other.owner);
    expect((await x.get(`/api/incidents/${id}`)).status).toBe(404);
    expect((await x.patch(`/api/incidents/${id}`, { version: 1, title: 'hax' })).status).toBe(404);
    expect(
      (await x.patch(`/api/incidents/${id}/status`, { version: 1, status: 'INVESTIGATING' }))
        .status,
    ).toBe(404);
    expect((await x.post(`/api/incidents/${id}/comments`, { body: 'hax' })).status).toBe(404);
    expect((await x.get('/api/incidents')).body.total).toBe(0);
  });

  it('cannot open an incident on, or assign to, things from another organization', async () => {
    const other = await setupOrg(app, 'b');
    const bad = await as(o.engineer).post('/api/incidents', {
      serviceId: other.serviceId,
      title: 'x',
      severity: 'SEV3',
    });
    expect(bad.status).toBe(404);
    expect(bad.body.error.code).toBe('SERVICE_NOT_FOUND');

    const { id } = await createIncident(app, o.engineer, o.serviceId);
    const outsider = (await as(other.owner).get('/api/auth/me')).body.user.id;
    const assign = await as(o.engineer).patch(`/api/incidents/${id}/assignee`, {
      version: 1,
      assigneeId: outsider,
    });
    expect(assign.status).toBe(400);
    expect(assign.body.error.code).toBe('INVALID_ASSIGNEE');
  });
});

describe('assignment', () => {
  it('assigns an org member and unassigns', async () => {
    const e = as(o.engineer);
    const me = (await e.get('/api/auth/me')).body.user;
    const { id } = await createIncident(app, o.engineer, o.serviceId);
    const assigned = await e.patch(`/api/incidents/${id}/assignee`, {
      version: 1,
      assigneeId: me.id,
    });
    expect(assigned.body.incident.assignee).toMatchObject({ id: me.id, email: me.email });
    const cleared = await e.patch(`/api/incidents/${id}/assignee`, {
      version: 2,
      assigneeId: null,
    });
    expect(cleared.body.incident.assignee).toBeNull();
  });
});

describe('list filters and pagination', () => {
  it('filters, paginates and reports totals', async () => {
    const e = as(o.engineer);
    const mk = (over: Record<string, unknown>) =>
      createIncident(app, o.engineer, o.serviceId, over);
    await mk({ title: 'a', severity: 'SEV1', priority: 'URGENT' });
    await mk({ title: 'b', severity: 'SEV2' });
    await mk({ title: 'c', severity: 'SEV2' });
    const d = await mk({ title: 'd', severity: 'SEV3' });
    await mk({ title: 'e', severity: 'SEV4' });
    await e.patch(`/api/incidents/${d.id}/status`, { version: 1, status: 'INVESTIGATING' });

    const all = await e.get('/api/incidents');
    expect(all.body).toMatchObject({ page: 1, limit: 20, total: 5 });

    const p1 = await e.get('/api/incidents?limit=2&page=1');
    const p2 = await e.get('/api/incidents?limit=2&page=2');
    const p3 = await e.get('/api/incidents?limit=2&page=3');
    expect([p1, p2, p3].map((r) => r.body.items.length)).toEqual([2, 2, 1]);
    expect(p1.body.total).toBe(5);
    const ids = [p1, p2, p3].flatMap((r) => r.body.items.map((i: { id: string }) => i.id));
    expect(new Set(ids).size).toBe(5);

    expect((await e.get('/api/incidents?severity=SEV2')).body.total).toBe(2);
    expect((await e.get('/api/incidents?status=INVESTIGATING')).body.items[0].title).toBe('d');
    expect((await e.get('/api/incidents?priority=URGENT')).body.total).toBe(1);
    expect((await e.get(`/api/incidents?serviceId=${o.serviceId}`)).body.total).toBe(5);
    expect((await e.get('/api/incidents?status=OPEN&severity=SEV2')).body.total).toBe(2);

    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect((await e.get(`/api/incidents?from=${encodeURIComponent(future)}`)).body.total).toBe(0);
    expect((await e.get(`/api/incidents?to=${encodeURIComponent(future)}`)).body.total).toBe(5);
  });

  it('filters by assignee', async () => {
    const e = as(o.engineer);
    const me = (await e.get('/api/auth/me')).body.user;
    const { id } = await createIncident(app, o.engineer, o.serviceId);
    await createIncident(app, o.engineer, o.serviceId);
    await e.patch(`/api/incidents/${id}/assignee`, { version: 1, assigneeId: me.id });
    const res = await e.get(`/api/incidents?assigneeId=${me.id}`);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].id).toBe(id);
  });

  it('rejects bad query values', async () => {
    expect((await as(o.owner).get('/api/incidents?status=NOPE')).status).toBe(400);
    expect((await as(o.owner).get('/api/incidents?page=0')).status).toBe(400);
  });
});

describe('validation', () => {
  it('requires a version and at least one field on update', async () => {
    const { id } = await createIncident(app, o.engineer, o.serviceId);
    expect(
      (await as(o.engineer).patch(`/api/incidents/${id}`, { title: 'no version' })).status,
    ).toBe(400);
    expect((await as(o.engineer).patch(`/api/incidents/${id}`, { version: 1 })).status).toBe(400);
    expect(
      (await as(o.engineer).patch('/api/incidents/not-a-uuid', { version: 1, title: 'x' })).status,
    ).toBe(400);
  });
});
