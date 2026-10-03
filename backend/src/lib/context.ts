import type { Request } from 'express';
import type { AuthContext } from '../middleware/auth';

/** Who is doing what, and from where. Passed into every write so it can be audited. */
export interface RequestContext {
  actor: AuthContext;
  ip: string | null;
  userAgent: string | null;
}

export const contextFrom = (req: Request): RequestContext => ({
  actor: req.auth!,
  ip: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});
