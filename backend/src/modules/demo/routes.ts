import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { organizationMembers, users } from '../../db/schema';
import { config } from '../../lib/config';
import { NotFoundError, AppError } from '../../lib/errors';
import { setAuthCookie, signToken } from '../../middleware/auth';
import { rateLimit } from '../../middleware/rateLimit';
import { DEMO_EMAIL_DOMAIN } from '../../middleware/demoGuard';
import { contextFrom } from '../../lib/context';
import { withLock } from '../../lib/locks';
import { requireRole } from '../../middleware/auth';
import { simulateLimit } from '../../middleware/rateLimit';
import { simulatePaymentIncident } from './simulate';

export const demoRouter = Router();

const demoSessionLimit = rateLimit(
  { name: 'demo-session', limit: 20, windowMs: 60_000 },
  (req) => req.ip ?? 'unknown',
);

/** Public: does this server offer the one-click demo? Lets the login page decide whether to show the button. */
demoRouter.get('/status', (_req, res) => {
  res.json({ enabled: config.DEMO_MODE, resetHours: config.DEMO_RESET_HOURS });
});

/**
 * Public, and only when DEMO_MODE is on: sign in as the shared demo admin with no password.
 * Safe because that account only exists in the disposable demo data, is blocked from configuration
 * changes (see demoReadOnly), and the endpoint is rate limited. Without DEMO_MODE it does not exist.
 */
demoRouter.post('/session', demoSessionLimit, async (_req, res) => {
  if (!config.DEMO_MODE) throw new NotFoundError('Route not found');
  const [row] = await db
    .select({ userId: users.id, organizationId: organizationMembers.organizationId })
    .from(users)
    .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
    .where(eq(users.email, `demo-admin${DEMO_EMAIL_DOMAIN}`));
  if (!row)
    throw new AppError(
      503,
      'DEMO_NOT_READY',
      'The demo data is still being prepared. Try again in a moment.',
    );
  setAuthCookie(res, signToken(row.userId, row.organizationId));
  res.json({ ok: true });
});

demoRouter.post('/simulate-incident', ...requireRole('ADMIN'), simulateLimit, async (req, res) => {
  const ctx = contextFrom(req);
  // One simulation per organization at a time, so a double-click cannot create two outages.
  const result = await withLock(`simulate:${ctx.actor.organizationId}`, 30_000, () =>
    simulatePaymentIncident(ctx),
  );
  res.status(201).json(result);
});
