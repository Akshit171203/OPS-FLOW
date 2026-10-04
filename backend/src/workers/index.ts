import type { Worker } from 'bullmq';
import { createAnalysisWorker } from './analysisWorker';
import { createEventWorker } from './eventWorker';
import { createRunbookWorker } from './runbookWorker';

/**
 * Start every background worker in this process. The standalone worker process calls it, and so does the
 * API when EMBEDDED_WORKERS=true (for hosts without free background workers).
 */
export function startWorkers(): Worker[] {
  return [createEventWorker(), createRunbookWorker(), createAnalysisWorker()];
}
