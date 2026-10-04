import type { RequestHandler } from 'express';
import { config } from '../lib/config';
import { ForbiddenError } from '../lib/errors';

export const DEMO_EMAIL_DOMAIN = '@opsflow.demo';

/** True for the shared accounts of the public demo, and only while the server runs in demo mode. */
export const isDemoAccount = (email: string | undefined) =>
  config.DEMO_MODE && !!email && email.toLowerCase().endsWith(DEMO_EMAIL_DOMAIN);

/**
 * In the public demo, anyone can sign in as a shared account. Incident work stays open (that is the
 * demo), but configuration that could be abused or that costs money is read-only: API keys, members,
 * runbooks (they trigger embeddings), projects and services. Put this AFTER authentication.
 */
export const demoReadOnly: RequestHandler = (req, _res, next) => {
  if (isDemoAccount(req.auth?.email)) {
    throw new ForbiddenError('This setting is read-only in the public demo.', 'DEMO_READONLY');
  }
  next();
};
