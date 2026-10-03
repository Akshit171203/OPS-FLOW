import type { Logger } from 'pino';
import { ANALYSIS_QUEUE, type AnalysisJob } from '../events/queues';
import { getAIProvider } from '../modules/ai';
import type { AIProvider } from '../modules/ai/provider';
import { runAnalysis } from '../modules/analysis/pipeline';
import { createLoggedWorker } from './loggedWorker';

export function createAnalysisWorker(
  opts: { provider?: AIProvider; log?: Logger; concurrency?: number } = {},
) {
  return createLoggedWorker<AnalysisJob>(
    ANALYSIS_QUEUE,
    // the provider is resolved per job, so it can be swapped without restarting the worker
    (job, meta) => runAnalysis(job.data, { provider: opts.provider ?? getAIProvider(), ...meta }),
    {
      log: opts.log,
      concurrency: opts.concurrency,
      describe: (d) => ({ analysis_id: d.analysisId }),
    },
  );
}
