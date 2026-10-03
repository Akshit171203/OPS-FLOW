import { randomUUID } from 'node:crypto';
import { AppEventSchema, type AppEvent } from '@opsflow/shared';
import { logger } from '../lib/logger';
import { getEventsQueue } from './queues';

const PUBLISH_TIMEOUT_MS = 2000;
let publishFailures = 0;

export const getPublishFailureCount = () => publishFailures;

type Distribute<T> = T extends AppEvent
  ? Omit<T, 'eventId' | 'occurredAt' | 'organizationId' | 'requestId'>
  : never;
export type NewEvent = Distribute<AppEvent>;

export function buildEvent(
  event: NewEvent,
  meta: { organizationId: string; requestId: string },
): AppEvent {
  return AppEventSchema.parse({
    ...event,
    ...meta,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
  });
}

/**
 * Enqueue an event. Call ONLY after the originating database transaction has committed.
 * Never throws: the data change already happened, so a publish failure is logged and counted
 * (surfaced on the admin jobs endpoint) instead of failing the request. The outbox pattern
 * would close this gap and is a documented V2 improvement.
 */
export async function publishEvent(event: AppEvent): Promise<void> {
  try {
    await Promise.race([
      getEventsQueue().add(event.type, event, { jobId: event.eventId }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`publish timed out after ${PUBLISH_TIMEOUT_MS}ms`)),
          PUBLISH_TIMEOUT_MS,
        ).unref(),
      ),
    ]);
  } catch (err) {
    publishFailures += 1;
    logger.error(
      { err, event_id: event.eventId, request_id: event.requestId, event_type: event.type },
      'event publish failed after commit',
    );
  }
}
