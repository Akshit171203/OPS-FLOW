import type { IncidentDto, IncidentRealtimeData, RealtimeEventName } from '@opsflow/shared';
import { buildEvent, publishEvent, type NewEvent } from '../../events/publisher';
import type { RequestContext } from '../../lib/context';
import { invalidateOrgViews } from '../../lib/cache';
import { publishRealtime, rooms } from '../../realtime/channel';

export type IncidentChange =
  'created' | 'updated' | 'assigned' | 'status_changed' | 'comment_added' | 'resolved';

const realtimeName: Record<IncidentChange, RealtimeEventName> = {
  created: 'incident.created',
  updated: 'incident.updated',
  assigned: 'incident.updated',
  status_changed: 'incident.status_changed',
  resolved: 'incident.status_changed',
  comment_added: 'incident.comment_added',
};

/** Push a live update to everyone viewing the organization or this incident. Best effort. */
export function emitIncidentRealtime(
  ctx: RequestContext,
  incident: IncidentDto,
  change: IncidentChange,
  extra: { commentId?: string } = {},
): Promise<void> {
  const data: IncidentRealtimeData = { incidentId: incident.id, incident, ...extra };
  return publishRealtime(
    [rooms.org(ctx.actor.organizationId), rooms.incident(incident.id)],
    realtimeName[change],
    data,
  );
}

/**
 * Translate a committed incident change into (a) a queued domain event for the worker and
 * (b) a realtime push to connected browsers. Call after the commit. Neither can throw.
 * Realtime is sent directly rather than via the worker so live updates do not depend on it.
 */
export async function emitIncidentEvent(
  ctx: RequestContext,
  incident: IncidentDto,
  change: IncidentChange,
  details: Record<string, unknown> = {},
): Promise<void> {
  const facts = {
    incidentId: incident.id,
    title: incident.title,
    actorId: ctx.actor.userId,
    assigneeId: incident.assignee?.id ?? null,
    createdBy: incident.createdBy,
  };
  let event: NewEvent;
  if (change === 'created') {
    event = {
      type: 'incident.created',
      payload: { ...facts, severity: incident.severity, serviceId: incident.serviceId },
    };
  } else if (change === 'resolved') {
    event = { type: 'incident.resolved', payload: facts };
  } else {
    event = { type: 'incident.updated', payload: { ...facts, change, details } };
  }
  await Promise.all([
    invalidateOrgViews(ctx.actor.organizationId), // open/critical counts and resolution time changed
    publishEvent(
      buildEvent(event, { organizationId: ctx.actor.organizationId, requestId: ctx.requestId }),
    ),
    emitIncidentRealtime(ctx, incident, change, {
      commentId: typeof details.commentId === 'string' ? details.commentId : undefined,
    }),
  ]);
}
