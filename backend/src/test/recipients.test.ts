import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AppEvent } from '@opsflow/shared';
import { recipientsFor } from '../modules/notifications/recipients';

const [actor, assignee, creator, admin1, admin2] = Array.from({ length: 5 }, () => randomUUID());
const common = {
  eventId: randomUUID(),
  organizationId: randomUUID(),
  occurredAt: new Date().toISOString(),
  requestId: 'r1',
};
const facts = {
  incidentId: randomUUID(),
  title: 'Checkout down',
  actorId: actor!,
  assigneeId: assignee!,
  createdBy: creator!,
};
const ids = (r: { userId: string }[]) => r.map((x) => x.userId).sort();

describe('recipientsFor', () => {
  it('created: assignee plus admins, never the actor, no duplicates', () => {
    const event: AppEvent = {
      ...common,
      type: 'incident.created',
      payload: { ...facts, severity: 'SEV1', serviceId: randomUUID() },
    };
    const r = recipientsFor(event, [admin1!, admin2!, actor!, assignee!]);
    expect(ids(r)).toEqual([assignee!, admin1!, admin2!].sort());
    expect(r[0]!.message).toBe('New SEV1 incident: Checkout down');
  });

  it('created without an assignee only reaches admins', () => {
    const event: AppEvent = {
      ...common,
      type: 'incident.created',
      payload: { ...facts, assigneeId: null, severity: 'SEV3', serviceId: randomUUID() },
    };
    expect(ids(recipientsFor(event, [admin1!]))).toEqual([admin1!]);
  });

  it('resolved: assignee and creator', () => {
    const event: AppEvent = { ...common, type: 'incident.resolved', payload: facts };
    expect(ids(recipientsFor(event, [admin1!]))).toEqual([assignee!, creator!].sort());
  });

  it('assigned: only the new assignee, with an assignment message', () => {
    const event: AppEvent = {
      ...common,
      type: 'incident.updated',
      payload: { ...facts, change: 'assigned', details: {} },
    };
    const r = recipientsFor(event, [admin1!]);
    expect(ids(r)).toEqual([assignee!]);
    expect(r[0]).toMatchObject({
      type: 'incident.assigned',
      message: 'You were assigned: Checkout down',
    });
  });

  it('status change and comment go to the assignee unless they did it themselves', () => {
    const status: AppEvent = {
      ...common,
      type: 'incident.updated',
      payload: { ...facts, change: 'status_changed', details: { to: 'MITIGATING' } },
    };
    expect(recipientsFor(status, [])[0]!.message).toBe(
      'Status changed to MITIGATING: Checkout down',
    );
    const selfComment: AppEvent = {
      ...common,
      type: 'incident.updated',
      payload: { ...facts, actorId: assignee!, change: 'comment_added', details: {} },
    };
    expect(recipientsFor(selfComment, [])).toEqual([]);
  });

  it('notification.requested goes to exactly the requested user', () => {
    const event: AppEvent = {
      ...common,
      type: 'notification.requested',
      payload: { userId: admin2!, notificationType: 'ping', message: 'hello' },
    };
    expect(recipientsFor(event, [admin1!])).toEqual([
      { userId: admin2, type: 'ping', message: 'hello', incidentId: null },
    ]);
  });
});
