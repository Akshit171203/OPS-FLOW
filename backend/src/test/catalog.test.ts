import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from './request';
import { buildApp } from '../app';
import { pool } from '../db/client';
import { resetDb, setupOrg } from './helpers';

const app = buildApp();
afterAll(() => pool.end());
beforeEach(resetDb);

describe('projects and services', () => {
  it('ADMIN creates, ENGINEER and VIEWER cannot, everyone can read', async () => {
    const o = await setupOrg(app);
    const denied = await request(app)
      .post('/api/projects')
      .set('cookie', o.engineer)
      .send({ name: 'X', slug: 'x' });
    expect(denied.status).toBe(403);

    for (const cookie of [o.viewer, o.engineer]) {
      const list = await request(app).get('/api/projects').set('cookie', cookie);
      expect(list.status).toBe(200);
      expect(list.body).toMatchObject({ page: 1, limit: 20, total: 1 });
    }
    const services = await request(app).get('/api/services').set('cookie', o.viewer);
    expect(services.body.items[0]).toMatchObject({
      name: 'Payment Service',
      projectName: 'Platform',
      status: 'UNKNOWN',
    });
  });

  it('rejects duplicate slugs with 409 SLUG_TAKEN', async () => {
    const o = await setupOrg(app);
    const p = await request(app)
      .post('/api/projects')
      .set('cookie', o.admin)
      .send({ name: 'Again', slug: 'platform' });
    expect(p.status).toBe(409);
    expect(p.body.error.code).toBe('SLUG_TAKEN');
    const s = await request(app)
      .post('/api/services')
      .set('cookie', o.admin)
      .send({ projectId: o.projectId, name: 'Again', slug: 'payment' });
    expect(s.status).toBe(409);
    expect(s.body.error.code).toBe('SLUG_TAKEN');
  });

  it('updates service status and keeps data scoped to the organization', async () => {
    const a = await setupOrg(app, 'a');
    const b = await setupOrg(app, 'b');
    const patched = await request(app)
      .patch(`/api/services/${a.serviceId}`)
      .set('cookie', a.admin)
      .send({ status: 'DEGRADED' });
    expect(patched.status).toBe(200);
    expect(patched.body.service.status).toBe('DEGRADED');

    expect((await request(app).get('/api/services').set('cookie', b.owner)).body.total).toBe(1);
    const cross = await request(app)
      .patch(`/api/services/${a.serviceId}`)
      .set('cookie', b.admin)
      .send({ status: 'DOWN' });
    expect(cross.status).toBe(404);
    const crossProject = await request(app)
      .post('/api/services')
      .set('cookie', b.admin)
      .send({ projectId: a.projectId, name: 'Sneaky', slug: 'sneaky' });
    expect(crossProject.status).toBe(404);
  });

  it('validates input and pagination bounds', async () => {
    const o = await setupOrg(app);
    const bad = await request(app)
      .post('/api/projects')
      .set('cookie', o.admin)
      .send({ name: 'X', slug: 'Not A Slug' });
    expect(bad.status).toBe(400);
    expect((await request(app).get('/api/projects?limit=1000').set('cookie', o.owner)).status).toBe(
      400,
    );
  });
});

describe('service detail', () => {
  it('returns one service for any member, 404 for another organization, 400 for a bad id', async () => {
    const o = await setupOrg(app);
    const other = await setupOrg(app, 'b');
    const res = await request(app).get(`/api/services/${o.serviceId}`).set('cookie', o.viewer);
    expect(res.status).toBe(200);
    expect(res.body.service).toMatchObject({
      id: o.serviceId,
      name: 'Payment Service',
      projectName: 'Platform',
      status: 'UNKNOWN',
    });
    expect(
      (await request(app).get(`/api/services/${o.serviceId}`).set('cookie', other.owner)).status,
    ).toBe(404);
    expect(
      (await request(app).get('/api/services/not-a-uuid').set('cookie', o.viewer)).status,
    ).toBe(400);
    expect((await request(app).get(`/api/services/${o.serviceId}`)).status).toBe(401);
  });

  it('does not shadow the health route', async () => {
    const o = await setupOrg(app);
    expect((await request(app).get('/api/services/health').set('cookie', o.viewer)).status).toBe(
      200,
    );
  });
});
