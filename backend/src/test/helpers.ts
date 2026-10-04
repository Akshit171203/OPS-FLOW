import type { Express } from 'express';
import type { Response } from 'supertest';
import request from './request';
import { expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { signToken } from '../middleware/auth';

export async function resetDb() {
  await db.execute(
    sql`TRUNCATE users, organizations, organization_members, idempotency_keys, revoked_sessions RESTART IDENTITY CASCADE`,
  );
}

/** Returns "opsflow_token=<jwt>" from a response's Set-Cookie header. */
export function cookieFrom(res: Response): string {
  const raw = (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) =>
    c.startsWith('opsflow_token='),
  );
  if (!raw) throw new Error('no auth cookie');
  return raw.split(';')[0]!;
}

export async function register(
  app: Express,
  over: Partial<{ email: string; password: string; name: string; organizationName: string }> = {},
) {
  const payload = {
    email: 'owner@example.com',
    password: 'correct-horse-battery',
    name: 'Owner',
    organizationName: 'Acme',
    ...over,
  };
  const res = await request(app).post('/api/auth/register').send(payload);
  return { res, payload, cookie: res.status === 201 ? cookieFrom(res) : '' };
}

/** Registers a user, adds them to the owner's org with `role`, and returns a cookie scoped to that org. */
export async function addMemberWithRole(
  app: Express,
  ownerCookie: string,
  email: string,
  role: 'ADMIN' | 'ENGINEER' | 'VIEWER',
) {
  const { cookie } = await register(app, { email, organizationName: `${email}-org` });
  expect(cookie).toBeTruthy();
  const add = await request(app)
    .post('/api/members')
    .set('cookie', ownerCookie)
    .send({ email, role });
  expect(add.status).toBe(201);
  const me = await request(app).get('/api/auth/me').set('cookie', ownerCookie);
  // login picks the user's earliest membership (their own org), so mint a token for the target org
  return `opsflow_token=${signToken(add.body.member.userId, me.body.organization.id)}`;
}

export interface TestOrg {
  owner: string;
  admin: string;
  engineer: string;
  viewer: string;
  serviceId: string;
  projectId: string;
}

/** An organization with one user per role plus a project and a service. */
export async function setupOrg(app: Express, tag = 'a'): Promise<TestOrg> {
  const { cookie: owner } = await register(app, {
    email: `owner-${tag}@example.com`,
    organizationName: `Org ${tag}`,
  });
  const admin = await addMemberWithRole(app, owner, `admin-${tag}@example.com`, 'ADMIN');
  const engineer = await addMemberWithRole(app, owner, `eng-${tag}@example.com`, 'ENGINEER');
  const viewer = await addMemberWithRole(app, owner, `viewer-${tag}@example.com`, 'VIEWER');
  const project = await request(app)
    .post('/api/projects')
    .set('cookie', admin)
    .send({ name: 'Platform', slug: 'platform' });
  expect(project.status).toBe(201);
  const service = await request(app)
    .post('/api/services')
    .set('cookie', admin)
    .send({ projectId: project.body.project.id, name: 'Payment Service', slug: 'payment' });
  expect(service.status).toBe(201);
  return {
    owner,
    admin,
    engineer,
    viewer,
    projectId: project.body.project.id,
    serviceId: service.body.service.id,
  };
}

export async function createIncident(
  app: Express,
  cookie: string,
  serviceId: string,
  over: Record<string, unknown> = {},
) {
  const res = await request(app)
    .post('/api/incidents')
    .set('cookie', cookie)
    .send({ serviceId, title: 'Payments failing', severity: 'SEV2', ...over });
  expect(res.status).toBe(201);
  return res.body.incident as { id: string; version: number; status: string };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls until `fn` returns a truthy value (or throws on timeout); avoids fixed sleeps in async tests. */
export async function waitFor<T>(
  fn: () => Promise<T> | T,
  timeoutMs = 8000,
): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value as NonNullable<T>;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await sleep(25);
  }
}

export async function userIdOf(app: Express, cookie: string): Promise<string> {
  const res = await request(app).get('/api/auth/me').set('cookie', cookie);
  return res.body.user.id as string;
}
