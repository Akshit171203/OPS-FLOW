import type { AppEvent } from '@opsflow/shared';
import { processOnce } from '../../lib/idempotency';
import { notificationsRepository as repo } from './repository';
import { recipientsFor } from './recipients';

export const NOTIFICATION_SCOPE = 'notifications';

/** Turns one event into notification rows, exactly once per event id. */
export async function handleEvent(event: AppEvent): Promise<{ created: number }> {
  const outcome = await processOnce(event.eventId, NOTIFICATION_SCOPE, async (tx) => {
    const adminIds =
      event.type === 'notification.requested' ? [] : await repo.adminIds(tx, event.organizationId);
    const wanted = recipientsFor(event, adminIds);
    const members = await repo.filterMembers(
      tx,
      event.organizationId,
      wanted.map((r) => r.userId),
    );
    const rows = wanted
      .filter((r) => members.has(r.userId))
      .map((r) => ({
        organizationId: event.organizationId,
        userId: r.userId,
        eventId: event.eventId,
        type: r.type,
        payload: { message: r.message, incidentId: r.incidentId },
        metadata: { requestId: event.requestId, eventType: event.type },
      }));
    await repo.insertMany(tx, rows);
    return rows.length;
  });
  return { created: outcome.ran ? outcome.result : 0 };
}
