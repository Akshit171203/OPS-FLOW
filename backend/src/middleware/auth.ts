import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { and, eq } from 'drizzle-orm';
import type { Role } from '@opsflow/shared';
import { roleRank } from '@opsflow/shared';
import { db } from '../db/client';
import { organizationMembers, organizations, users } from '../db/schema';
import { config, isProduction } from '../lib/config';
import { ForbiddenError, UnauthorizedError } from '../lib/errors';

export const COOKIE_NAME = 'opsflow_token';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  organizationId: string;
  organizationName: string;
  role: Role;
}

interface TokenPayload {
  sub: string;
  org: string;
}

export function signToken(userId: string, organizationId: string): string {
  return jwt.sign({ org: organizationId }, config.JWT_SECRET, {
    subject: userId,
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function setAuthCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/**
 * Verifies the signed cookie, then re-checks membership in the database so a removed
 * member or changed role takes effect immediately. The organization comes from the
 * signed token + membership row, never from a client-supplied header.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  if (!token) throw new UnauthorizedError();

  let payload: TokenPayload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET) as unknown as TokenPayload;
  } catch {
    throw new UnauthorizedError('Invalid or expired session');
  }

  const [row] = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      organizationId: organizations.id,
      organizationName: organizations.name,
      role: organizationMembers.role,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(
      and(
        eq(organizationMembers.userId, payload.sub),
        eq(organizationMembers.organizationId, payload.org),
      ),
    );
  if (!row) throw new UnauthorizedError('Invalid or expired session');

  req.auth = row;
  req.log = req.log.child({ user_id: row.userId, org_id: row.organizationId });
  next();
}

export function requireRole(minRole: Role): RequestHandler[] {
  const check: RequestHandler = (req, _res, next) => {
    if (roleRank[req.auth!.role] < roleRank[minRole]) throw new ForbiddenError();
    next();
  };
  return [requireAuth, check];
}
