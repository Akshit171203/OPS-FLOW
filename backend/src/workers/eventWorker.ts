import { UnrecoverableError, Worker, type Job } from 'bullmq';
import type { Logger } from 'pino';
import { AppEventSchema, type AppEvent } from '@opsflow/shared';
import { EVENTS_QUEUE } from '../events/queues';
import { backoffDelay } from '../events/retryPolicy';
import { config } from '../lib/config';
import { logger as rootLogger } from '../lib/logger';
import { createRedis } from '../lib/redis';
import { handleEvent } from '../modules/notifications/handler';

export type EventHandler = (event: AppEvent) => Promise<unknown>;

export interface EventWorkerOptions {
  handler?: EventHandler;
  log?: Logger;
  concurrency?: number;
}

/**
 * The one worker for the events queue. It validates the payload, logs every attempt with the
 * ids needed to trace it back to the HTTP request, and lets BullMQ apply the retry policy.
 */
export function createEventWorker({
  handler = handleEvent,
  log = rootLogger,
  concurrency = config.WORKER_CONCURRENCY,
}: EventWorkerOptions = {}): Worker<AppEvent> {
  const processor = async (job: Job<AppEvent>) => {
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? 1;
    const raw = job.data as Partial<AppEvent>;
    const jobLog = log.child({
      job_id: job.id,
      event_id: raw.eventId,
      request_id: raw.requestId,
      event_type: raw.type,
      attempt,
    });
    const started = Date.now();
    jobLog.info('job started');
    try {
      const parsed = AppEventSchema.safeParse(job.data);
      // A malformed payload can never succeed, so do not burn retries on it.
      if (!parsed.success)
        throw new UnrecoverableError(`invalid event payload: ${parsed.error.message}`);
      const result = await handler(parsed.data);
      jobLog.info({ duration_ms: Date.now() - started, result }, 'job succeeded');
      return result;
    } catch (err) {
      jobLog.error(
        {
          err,
          duration_ms: Date.now() - started,
          will_retry: attempt < maxAttempts && !(err instanceof UnrecoverableError),
        },
        'job failed',
      );
      throw err;
    }
  };

  return new Worker<AppEvent>(EVENTS_QUEUE, processor, {
    connection: createRedis(),
    prefix: config.QUEUE_PREFIX,
    concurrency,
    settings: { backoffStrategy: (attemptsMade: number) => backoffDelay(attemptsMade) },
  });
}
