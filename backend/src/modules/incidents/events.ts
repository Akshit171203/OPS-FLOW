import type { IncidentDto } from '@opsflow/shared';
import { buildEvent, publishEvent, type NewEvent } from '../../events/publisher';
import type { RequestContext } from '../../lib/context';

export type IncidentChange =
  'created' | 'updated' | 'assigned' | 'status_changed' | 'comment_added' | 'resolved';

/** Translate a committed incident change into an event and publish it. Call after the commit. */
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
  await publishEvent(
    buildEvent(event, { organizationId: ctx.actor.organizationId, requestId: ctx.requestId }),
  );
}
