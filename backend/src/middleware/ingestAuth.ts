import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ApiKeyScope } from '@opsflow/shared';
import { db } from '../db/client';
import { hashApiKey, looksLikeApiKey } from '../lib/apiKeys';
import { ForbiddenError, RateLimitError, UnauthorizedError } from '../lib/errors';
import { consume } from '../lib/rateLimiter';
import { apiKeysRepository } from '../modules/apikeys/repository';
import { requireRole } from './auth';
import { rules } from './rateLimit';

/** Run one Express middleware as a promise, so several can be chained inside one. */
function run(handler: RequestHandler, req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    const next: NextFunction = (err?: unknown) => (err ? reject(err) : resolve());
    Promise.resolve(handler(req, res, next)).catch(reject);
  });
}

/** Count a failed attempt; past the limit the answer becomes 429, which slows guessing further. */
async function rejectBadKey(req: Request): Promise<never> {
  try {
    const result = await consume(rules.badApiKey, req.ip ?? 'unknown');
    if (!result.allowed) throw new RateLimitError('Too many invalid API keys. Try again later.');
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    // Redis unavailable: fail open on the counter, still reject the key
  }
  throw new UnauthorizedError('Invalid API key', 'INVALID_API_KEY');
}

async function authenticateApiKey(req: Request, header: string, scope: ApiKeyScope): Promise<void> {
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  const key = match?.[1];
  if (!key || !looksLikeApiKey(key)) return rejectBadKey(req);

  const row = await apiKeysRepository.findByHash(db, hashApiKey(key));
  if (!row || row.revokedAt) return rejectBadKey(req);
  if (!row.scopes.includes(scope)) {
    throw new ForbiddenError(`This API key does not have the "${scope}" permission`, 'KEY_SCOPE');
  }

  // The key acts as its own hidden service-account user, so audit logs and timelines say who did it
  req.auth = {
    userId: row.botUserId,
    email: row.botEmail,
    name: row.name,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    role: 'ENGINEER',
  };
  req.apiKey = {
    id: row.id,
    name: row.name,
    scopes: row.scopes as ApiKeyScope[],
    serviceId: row.serviceId,
  };
  req.log = req.log.child({ api_key_id: row.id, org_id: row.organizationId });
  void apiKeysRepository.touchLastUsed(db, row.id).catch(() => undefined);
}

/**
 * Authentication for endpoints that machines call. An `Authorization: Bearer ofk_...` header means "this is
 * an API key": it must be valid (no fallback to a session if it is not). Without the header the request
 * must come from a signed-in ENGINEER or above, exactly as before. The alerts scope is API-key only.
 */
export function ingestAuth(scope: ApiKeyScope): RequestHandler {
  const sessionAuth = requireRole('ENGINEER');
  return async (req, res, next) => {
    const header = req.header('authorization');
    if (header !== undefined) {
      await authenticateApiKey(req, header, scope);
      return next();
    }
    if (scope === 'alerts')
      throw new UnauthorizedError('An API key is required for this endpoint', 'API_KEY_REQUIRED');
    for (const handler of sessionAuth) await run(handler, req, res);
    next();
  };
}
