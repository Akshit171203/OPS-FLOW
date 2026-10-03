import type { Express } from 'express';
import request from 'supertest';
import { expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { signToken } from '../middleware/auth';

export async function resetDb() {
  await db.execute(
    sql`TRUNCATE users, organizations, organization_members RESTART IDENTITY CASCADE`,
  );
}

/** Returns "opsflow_token=<jwt>" from a response's Set-Cookie header. */
export function cookieFrom(res: request.Response): string {
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
