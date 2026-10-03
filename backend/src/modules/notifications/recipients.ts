import type { AppEvent } from '@opsflow/shared';

export interface Recipient {
  userId: string;
  type: string;
  message: string;
  incidentId: string | null;
}

/**
 * Who gets notified about an event. The person who caused the change is never notified of it.
 * `adminIds` are the organization's OWNER/ADMIN members, looked up by the caller.
 */
export function recipientsFor(event: AppEvent, adminIds: readonly string[]): Recipient[] {
  if (event.type === 'notification.requested') {
    const p = event.payload;
    return [
      {
        userId: p.userId,
        type: p.notificationType,
        message: p.message,
        incidentId: p.incidentId ?? null,
      },
    ];
  }

  const p = event.payload;
  const { incidentId, title } = p;
  let userIds: (string | null)[];
  let type: string;
  let message: string;

  switch (event.type) {
    case 'incident.created':
      userIds = [p.assigneeId, ...adminIds];
      type = 'incident.created';
      message = `New ${event.payload.severity} incident: ${title}`;
      break;
    case 'incident.resolved':
      userIds = [p.assigneeId, p.createdBy];
      type = 'incident.resolved';
      message = `Incident resolved: ${title}`;
      break;
    case 'incident.updated': {
      const { change, details } = event.payload;
      type = `incident.${change}`;
      userIds = [p.assigneeId]; // for 'assigned' this is already the new assignee
      message =
        change === 'assigned'
          ? `You were assigned: ${title}`
          : change === 'status_changed'
            ? `Status changed to ${String(details.to)}: ${title}`
            : change === 'comment_added'
              ? `New comment on: ${title}`
              : `Incident updated: ${title}`;
      break;
    }
  }

  const unique = new Set(userIds.filter((id): id is string => !!id && id !== p.actorId));
  return [...unique].map((userId) => ({ userId, type, message, incidentId }));
}
