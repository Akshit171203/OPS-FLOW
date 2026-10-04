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

export interface CookieSettings {
  secure: boolean;
  sameSite: 'lax' | 'strict';
  domain?: string;
}

/** Cookie flags per environment: Secure in production, SameSite and Domain from configuration. */
export function authCookieOptions(
  settings: CookieSettings = {
    secure: config.COOKIE_SECURE ?? isProduction,
    sameSite: config.COOKIE_SAMESITE,
    domain: config.COOKIE_DOMAIN,
  },
) {
  return {
    httpOnly: true,
    secure: settings.secure,
    sameSite: settings.sameSite,
    path: '/',
    ...(settings.domain ? { domain: settings.domain } : {}),
  } as const;
}

export function setAuthCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, { ...authCookieOptions(), maxAge: COOKIE_MAX_AGE_MS });
}

export function clearAuthCookie(res: Response) {
  // Must use the same domain/path attributes as when the cookie was set, or browsers keep it.
  res.clearCookie(COOKIE_NAME, authCookieOptions());
}

/**
 * Verifies a signed session token, then re-checks membership in the database so a removed
 * member or changed role takes effect immediately. The organization comes from the signed
 * token + membership row, never from a client-supplied header. Shared by HTTP and sockets.
 */
export async function authenticateToken(token: string | undefined): Promise<AuthContext> {
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
  return row;
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const auth = await authenticateToken(req.cookies?.[COOKIE_NAME] as string | undefined);
  req.auth = auth;
  req.log = req.log.child({ user_id: auth.userId, org_id: auth.organizationId });
  next();
}

export function requireRole(minRole: Role): RequestHandler[] {
  const check: RequestHandler = (req, _res, next) => {
    if (roleRank[req.auth!.role] < roleRank[minRole]) throw new ForbiddenError();
    next();
  };
  return [requireAuth, check];
}
