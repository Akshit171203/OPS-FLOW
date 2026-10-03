import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app';
import { pool } from '../db/client';
import { signToken } from '../middleware/auth';
import { addMemberWithRole, cookieFrom, register, resetDb } from './helpers';

const app = buildApp();

afterAll(async () => {
  await pool.end();
});
beforeEach(resetDb);

const call = (method: 'get' | 'post' | 'patch', url: string, cookie: string, payload?: object) =>
  request(app)[method](url).set('cookie', cookie).send(payload);

describe('RBAC', () => {
  it('VIEWER gets 403 on an ADMIN route, ADMIN succeeds', async () => {
    const { cookie: owner } = await register(app);
    const viewer = await addMemberWithRole(app, owner, 'viewer@example.com', 'VIEWER');
    const admin = await addMemberWithRole(app, owner, 'admin@example.com', 'ADMIN');
    await register(app, { email: 'new@example.com', organizationName: 'Other' });

    const denied = await call('post', '/api/members', viewer, {
      email: 'new@example.com',
      role: 'VIEWER',
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');

    const ok = await call('post', '/api/members', admin, {
      email: 'new@example.com',
      role: 'VIEWER',
    });
    expect(ok.status).toBe(201);
  });

  it('any member can list members, scoped to their organization', async () => {
    const { cookie: owner } = await register(app);
    const viewer = await addMemberWithRole(app, owner, 'viewer@example.com', 'VIEWER');
    await register(app, { email: 'other@example.com', organizationName: 'Other' });
    const res = await call('get', '/api/members', viewer);
    expect(res.status).toBe(200);
    expect(res.body.members.map((m: { email: string }) => m.email).sort()).toEqual([
      'owner@example.com',
      'viewer@example.com',
    ]);
  });

  it('a token for an org the user was removed from stops working', async () => {
    const { cookie: owner } = await register(app);
    await register(app, { email: 'outsider@example.com', organizationName: 'Other' });
    const me = await call('get', '/api/auth/me', owner);
    const outsiderLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'outsider@example.com', password: 'correct-horse-battery' });
    expect(outsiderLogin.status).toBe(200);
    // forge a token pointing the outsider at the owner's org: no membership row => 401
    const outsiderId = (await call('get', '/api/auth/me', cookieFrom(outsiderLogin))).body.user.id;
    const forged = `opsflow_token=${signToken(outsiderId, me.body.organization.id)}`;
    expect((await call('get', '/api/members', forged)).status).toBe(401);
  });
});

describe('member management', () => {
  it('rejects unknown users and duplicates', async () => {
    const { cookie: owner } = await register(app);
    const unknown = await call('post', '/api/members', owner, {
      email: 'ghost@example.com',
      role: 'VIEWER',
    });
    expect(unknown.status).toBe(404);
    const dup = await call('post', '/api/members', owner, {
      email: 'owner@example.com',
      role: 'VIEWER',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_MEMBER');
  });

  it('an ADMIN cannot demote an OWNER or grant OWNER', async () => {
    const { cookie: owner } = await register(app);
    const admin = await addMemberWithRole(app, owner, 'admin@example.com', 'ADMIN');
    const members = (await call('get', '/api/members', owner)).body.members as {
      id: string;
      role: string;
    }[];
    const ownerMember = members.find((m) => m.role === 'OWNER')!;
    const adminMember = members.find((m) => m.role === 'ADMIN')!;

    const demote = await call('patch', `/api/members/${ownerMember.id}`, admin, { role: 'VIEWER' });
    expect(demote.status).toBe(403);
    const promote = await call('patch', `/api/members/${adminMember.id}`, admin, { role: 'OWNER' });
    expect(promote.status).toBe(403);
  });

  it('an OWNER can change roles, but the last OWNER cannot be demoted', async () => {
    const { cookie: owner } = await register(app);
    await addMemberWithRole(app, owner, 'eng@example.com', 'VIEWER');
    const members = (await call('get', '/api/members', owner)).body.members as {
      id: string;
      role: string;
      email: string;
    }[];
    const eng = members.find((m) => m.email === 'eng@example.com')!;
    const ownerMember = members.find((m) => m.role === 'OWNER')!;

    const changed = await call('patch', `/api/members/${eng.id}`, owner, { role: 'ENGINEER' });
    expect(changed.status).toBe(200);
    expect(changed.body.member.role).toBe('ENGINEER');

    const last = await call('patch', `/api/members/${ownerMember.id}`, owner, { role: 'ADMIN' });
    expect(last.status).toBe(409);
    expect(last.body.error.code).toBe('LAST_OWNER');
  });

  it("cannot touch another organization's member (404)", async () => {
    const { cookie: owner } = await register(app);
    const { cookie: other } = await register(app, {
      email: 'o2@example.com',
      organizationName: 'Other',
    });
    const otherMembers = (await call('get', '/api/members', other)).body.members as {
      id: string;
    }[];
    const res = await call('patch', `/api/members/${otherMembers[0]!.id}`, owner, {
      role: 'VIEWER',
    });
    expect(res.status).toBe(404);
  });
});
