import { Queue } from 'bullmq';
import type { AppEvent } from '@opsflow/shared';
import { config } from '../lib/config';
import { createRedis } from '../lib/redis';
import { MAX_ATTEMPTS } from './retryPolicy';

export const EVENTS_QUEUE = 'incident-events';

let queue: Queue<AppEvent> | undefined;

export function getEventsQueue(): Queue<AppEvent> {
  queue ??= new Queue<AppEvent>(EVENTS_QUEUE, {
    connection: createRedis(),
    prefix: config.QUEUE_PREFIX,
    defaultJobOptions: {
      attempts: MAX_ATTEMPTS,
      backoff: { type: 'custom' },
      removeOnComplete: { count: 1000 },
      removeOnFail: false, // failed jobs stay inspectable with their error and attempt count
    },
  });
  return queue;
}

export async function closeQueues(): Promise<void> {
  const q = queue;
  queue = undefined;
  if (q) {
    await q.close();
    await q.opts.connection?.disconnect?.();
  }
}
