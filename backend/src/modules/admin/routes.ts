import { Router } from 'express';
import type { FailedJobDto } from '@opsflow/shared';
import { getEventsQueue } from '../../events/queues';
import { getPublishFailureCount } from '../../events/publisher';
import { requireRole } from '../../middleware/auth';

export const adminRouter = Router();

/** Failed jobs for the caller's organization only; jobs carry their organization id. */
adminRouter.get('/jobs/failed', ...requireRole('ADMIN'), async (req, res) => {
  const orgId = req.auth!.organizationId;
  const jobs = await getEventsQueue().getFailed(0, 199);
  const failed: FailedJobDto[] = jobs
    .filter((j) => j.data.organizationId === orgId)
    .map((j) => ({
      jobId: String(j.id),
      eventId: j.data.eventId,
      type: j.data.type,
      requestId: j.data.requestId,
      attemptsMade: j.attemptsMade,
      failedReason: j.failedReason,
      failedAt: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
    }));
  res.json({ failed, publishFailures: getPublishFailureCount() });
});
