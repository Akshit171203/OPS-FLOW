import { Queue } from 'bullmq';
import type { AppEvent } from '@opsflow/shared';
import { config } from '../lib/config';
import { createRedis } from '../lib/redis';
import { MAX_ATTEMPTS } from './retryPolicy';

export const EVENTS_QUEUE = 'incident-events';
export const RUNBOOK_QUEUE = 'runbook-indexing';
export const ANALYSIS_QUEUE = 'ai-analysis';

/** Every job carries who it belongs to, so failures can be shown only to the right organization. */
export interface RunbookJob {
  runbookId: string;
  organizationId: string;
  requestId: string;
}
export interface AnalysisJob {
  analysisId: string;
  organizationId: string;
  requestId: string;
}

const queues = new Map<string, Queue>();

function getQueue<T>(name: string): Queue<T> {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: createRedis(),
      prefix: config.QUEUE_PREFIX,
      defaultJobOptions: {
        attempts: MAX_ATTEMPTS,
        backoff: { type: 'custom' },
        removeOnComplete: { count: 1000 },
        removeOnFail: false, // failed jobs stay inspectable with their error and attempt count
      },
    });
    queues.set(name, q);
  }
  return q as unknown as Queue<T>;
}

export const getEventsQueue = () => getQueue<AppEvent>(EVENTS_QUEUE);
export const getRunbookQueue = () => getQueue<RunbookJob>(RUNBOOK_QUEUE);
export const getAnalysisQueue = () => getQueue<AnalysisJob>(ANALYSIS_QUEUE);
export const allQueues = () => [
  { name: EVENTS_QUEUE, queue: getEventsQueue() as Queue },
  { name: RUNBOOK_QUEUE, queue: getRunbookQueue() as Queue },
  { name: ANALYSIS_QUEUE, queue: getAnalysisQueue() as Queue },
];

export async function closeQueues(): Promise<void> {
  const open = [...queues.values()];
  queues.clear();
  await Promise.all(
    open.map(async (q) => {
      await q.close();
      await q.opts.connection?.disconnect?.();
    }),
  );
}
