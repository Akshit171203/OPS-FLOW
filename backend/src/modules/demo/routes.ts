import { Router } from 'express';
import { contextFrom } from '../../lib/context';
import { withLock } from '../../lib/locks';
import { requireRole } from '../../middleware/auth';
import { simulateLimit } from '../../middleware/rateLimit';
import { simulatePaymentIncident } from './simulate';

export const demoRouter = Router();

demoRouter.post('/simulate-incident', ...requireRole('ADMIN'), simulateLimit, async (req, res) => {
  const ctx = contextFrom(req);
  // One simulation per organization at a time, so a double-click cannot create two outages.
  const result = await withLock(`simulate:${ctx.actor.organizationId}`, 30_000, () =>
    simulatePaymentIncident(ctx),
  );
  res.status(201).json(result);
});
