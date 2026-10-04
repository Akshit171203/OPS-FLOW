import jwt from 'jsonwebtoken';
import { lt } from 'drizzle-orm';
import { db } from '../../db/client';
import { revokedSessions } from '../../db/schema';
import { config } from '../../lib/config';

/**
 * Signs a session out for good. The token's own id is recorded until the moment it would have expired
 * anyway, so a copy of it (a leaked cookie, a log line) stops working too. Other sessions of the same
 * user are untouched: the public demo shares one account between every visitor, so "sign out" must
 * never mean "sign out everyone".
 *
 * A token that is missing, malformed, expired or from before this feature has nothing to revoke, and
 * that is fine: the caller still clears the cookie.
 */
export async function revokeSession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET) as jwt.JwtPayload;
  } catch {
    return false;
  }
  if (!payload.jti || !payload.exp) return false;

  await db
    .insert(revokedSessions)
    .values({ jti: payload.jti, expiresAt: new Date(payload.exp * 1000) })
    .onConflictDoNothing();
  // Rows past their expiry can never matter again; drop them as sign-outs come in.
  await db.delete(revokedSessions).where(lt(revokedSessions.expiresAt, new Date()));
  return true;
}
