import type { AppEvent } from '@opsflow/shared';
import { notificationToDto } from './service';
import { processOnce } from '../../lib/idempotency';
import { publishRealtime, rooms } from '../../realtime/channel';
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
    return repo.insertMany(tx, rows);
  });
  if (!outcome.ran) return { created: 0 };

  // After commit: tell each recipient's open browser tabs. Best effort, never throws.
  await Promise.all(
    outcome.result.map((row) =>
      publishRealtime([rooms.user(row.userId)], 'notification.created', {
        notification: notificationToDto(row),
      }),
    ),
  );
  return { created: outcome.result.length };
}
