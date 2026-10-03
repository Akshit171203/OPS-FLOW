import { Router } from 'express';
import type { FailedJobDto } from '@opsflow/shared';
import { allQueues } from '../../events/queues';
import { getPublishFailureCount } from '../../events/publisher';
import { requireRole } from '../../middleware/auth';

export const adminRouter = Router();

interface JobData {
  organizationId?: string;
  requestId?: string;
  eventId?: string;
  type?: string;
  analysisId?: string;
  runbookId?: string;
}

/** Failed jobs from every queue, for the caller's organization only; each job carries its organization id. */
adminRouter.get('/jobs/failed', ...requireRole('ADMIN'), async (req, res) => {
  const orgId = req.auth!.organizationId;
  const failed: FailedJobDto[] = [];
  for (const { name, queue } of allQueues()) {
    for (const job of await queue.getFailed(0, 199)) {
      const data = job.data as JobData;
      if (data.organizationId !== orgId) continue;
      failed.push({
        queue: name,
        jobId: String(job.id),
        eventId: data.eventId ?? data.analysisId ?? data.runbookId ?? String(job.id),
        type: data.type ?? job.name,
        requestId: data.requestId ?? '',
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason,
        failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
      });
    }
  }
  failed.sort((a, b) => (b.failedAt ?? '').localeCompare(a.failedAt ?? ''));
  res.json({ failed, publishFailures: getPublishFailureCount() });
});
