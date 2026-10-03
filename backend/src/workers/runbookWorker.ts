import { UnrecoverableError } from 'bullmq';
import type { Logger } from 'pino';
import { RUNBOOK_QUEUE, type RunbookJob } from '../events/queues';
import { NotFoundError } from '../lib/errors';
import { getAIProvider } from '../modules/ai';
import { AIProviderError, type AIProvider } from '../modules/ai/provider';
import { indexRunbook, markIndexFailed } from '../modules/runbooks/indexer';
import { createLoggedWorker } from './loggedWorker';

export function createRunbookWorker(
  opts: { provider?: AIProvider; log?: Logger; concurrency?: number } = {},
) {
  return createLoggedWorker<RunbookJob>(
    RUNBOOK_QUEUE,
    async (job, { attempt, maxAttempts }) => {
      const { organizationId, runbookId } = job.data;
      try {
        return await indexRunbook(organizationId, runbookId, opts.provider ?? getAIProvider());
      } catch (err) {
        if (err instanceof NotFoundError) return { chunks: 0, written: false }; // the runbook was removed: nothing to do
        const retryable = err instanceof AIProviderError ? err.retryable : true;
        if (retryable && attempt < maxAttempts) throw err;
        await markIndexFailed(runbookId, err);
        throw new UnrecoverableError(err instanceof Error ? err.message : 'indexing failed');
      }
    },
    {
      log: opts.log,
      concurrency: opts.concurrency,
      describe: (d) => ({ runbook_id: d.runbookId }),
    },
  );
}
