import type { RequestHandler } from 'express';
import { config } from '../lib/config';
import { ForbiddenError } from '../lib/errors';
import { COOKIE_NAME } from './auth';

/** The frontend sends this on every request. A cross-site page cannot add a custom header without a CORS preflight, which strict CORS refuses. */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'opsflow';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for the cookie-authenticated API. Two independent layers on every state-changing
 * request: (1) a browser-sent Origin must be our web origin; (2) if the request carries the session
 * cookie it must also carry the custom header. SameSite on the cookie is a third layer. Requests
 * without the cookie (login, register) are not authenticated, so there is nothing to forge.
 */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.header('origin');
  if (origin && origin !== config.WEB_ORIGIN) {
    throw new ForbiddenError('Cross-origin request rejected', 'CSRF_ORIGIN');
  }
  if (req.cookies?.[COOKIE_NAME] && req.header(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
    throw new ForbiddenError('Missing CSRF protection header', 'CSRF_HEADER');
  }
  next();
};
