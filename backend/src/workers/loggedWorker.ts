import { Worker, type Job } from 'bullmq';
import type { Logger } from 'pino';
import { MAX_ATTEMPTS, backoffDelay } from '../events/retryPolicy';
import { config } from '../lib/config';
import { logger as rootLogger } from '../lib/logger';
import { createRedis } from '../lib/redis';

export interface JobMeta {
  attempt: number;
  maxAttempts: number;
}

export interface LoggedWorkerOptions<T> {
  log?: Logger;
  concurrency?: number;
  /** Extra identifiers to put on every log line for this job (for example analysis_id). */
  describe: (data: T) => Record<string, unknown>;
}

/**
 * A BullMQ worker that logs every attempt (start, success, failure) with the job id, the request id of
 * the HTTP call that caused it, the attempt number and the duration, then lets BullMQ apply the retry policy.
 */
export function createLoggedWorker<T extends { requestId: string }>(
  queueName: string,
  handle: (job: Job<T>, meta: JobMeta) => Promise<unknown>,
  { log = rootLogger, concurrency = config.WORKER_CONCURRENCY, describe }: LoggedWorkerOptions<T>,
): Worker<T> {
  return new Worker<T>(
    queueName,
    async (job) => {
      const attempt = job.attemptsMade + 1;
      const maxAttempts = job.opts.attempts ?? MAX_ATTEMPTS;
      const jobLog = log.child({
        queue: queueName,
        job_id: job.id,
        request_id: job.data.requestId,
        attempt,
        ...describe(job.data),
      });
      const started = Date.now();
      jobLog.info('job started');
      try {
        const result = await handle(job, { attempt, maxAttempts });
        jobLog.info({ duration_ms: Date.now() - started, result }, 'job succeeded');
        return result;
      } catch (err) {
        jobLog.error({ err, duration_ms: Date.now() - started }, 'job failed');
        throw err;
      }
    },
    {
      connection: createRedis(),
      prefix: config.QUEUE_PREFIX,
      concurrency,
      settings: { backoffStrategy: (attemptsMade: number) => backoffDelay(attemptsMade) },
    },
  );
}
