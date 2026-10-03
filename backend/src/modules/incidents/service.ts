import type {
  IncidentCommentDto,
  IncidentDetailResponse,
  IncidentDto,
  IncidentEventDto,
  IncidentStatus,
  Paginated,
  Priority,
  Severity,
} from '@opsflow/shared';
import { db, type Executor } from '../../db/client';
import type { RequestContext } from '../../lib/context';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { paginated } from '../../lib/pagination';
import { auditRepository } from '../audit/repository';
import { membersRepository } from '../members/repository';
import { servicesRepository } from '../services/repository';
import { emitIncidentEvent } from './events';
import { incidentsRepository as repo, type IncidentRow } from './repository';
import type { ListIncidentsQuery } from './schemas';
import { allowedTransitions, assertTransition } from './stateMachine';

type Row = NonNullable<IncidentRow>;

const toDto = (r: Row): IncidentDto => ({
  id: r.id,
  serviceId: r.serviceId,
  serviceName: r.serviceName,
  title: r.title,
  description: r.description,
  severity: r.severity,
  status: r.status,
  priority: r.priority,
  assignee: r.assigneeId
    ? { id: r.assigneeId, name: r.assigneeName!, email: r.assigneeEmail! }
    : null,
  createdBy: r.createdBy,
  startedAt: r.startedAt.toISOString(),
  resolvedAt: r.resolvedAt?.toISOString() ?? null,
  version: r.version,
  allowedNextStatuses: [...allowedTransitions(r.status)],
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const notFound = () => new NotFoundError('Incident not found', 'INCIDENT_NOT_FOUND');
const versionConflict = (current: number) =>
  new ConflictError(
    'This incident was changed by someone else. Reload and try again.',
    'VERSION_CONFLICT',
    { currentVersion: current },
  );

async function requireIncident(ex: Executor, ctx: RequestContext, id: string): Promise<Row> {
  const row = await repo.find(ex, ctx.actor.organizationId, id);
  if (!row) throw notFound();
  return row;
}

async function requireAssignee(ex: Executor, ctx: RequestContext, userId: string) {
  const member = await membersRepository.findMemberByUser(ex, ctx.actor.organizationId, userId);
  if (!member) {
    throw new ValidationError(
      'Assignee must be a member of this organization',
      undefined,
      'INVALID_ASSIGNEE',
    );
  }
}

/**
 * Shared shape of every versioned change: check the version, update with the version guard,
 * then write the timeline event and audit log. The caller runs this inside one transaction.
 */
async function applyChange(
  tx: Executor,
  ctx: RequestContext,
  current: Row,
  expectedVersion: number,
  set: Parameters<typeof repo.updateIfVersion>[4],
  event: { type: string; metadata: Record<string, unknown> },
): Promise<IncidentDto> {
  if (current.version !== expectedVersion) throw versionConflict(current.version);
  const orgId = ctx.actor.organizationId;
  const updated = await repo.updateIfVersion(tx, orgId, current.id, expectedVersion, set);
  if (!updated) throw versionConflict(current.version + 1); // lost a race between read and write
  await repo.insertEvent(tx, {
    organizationId: orgId,
    incidentId: current.id,
    actorId: ctx.actor.userId,
    eventType: event.type,
    metadata: event.metadata,
  });
  await auditRepository.insert(tx, ctx, {
    action: event.type,
    resourceType: 'incident',
    resourceId: current.id,
    metadata: event.metadata,
  });
  return toDto(await requireIncident(tx, ctx, current.id));
}

export const incidentsService = {
  async list(ctx: RequestContext, q: ListIncidentsQuery): Promise<Paginated<IncidentDto>> {
    const { rows, total } = await repo.list(db, ctx.actor.organizationId, q);
    return paginated(rows.map(toDto), total, q);
  },

  async get(ctx: RequestContext, id: string): Promise<IncidentDetailResponse> {
    const orgId = ctx.actor.organizationId;
    const incident = toDto(await requireIncident(db, ctx, id));
    const [events, comments] = await Promise.all([
      repo.listEvents(db, orgId, id),
      repo.listComments(db, orgId, id),
    ]);
    return {
      incident,
      events: events.map((e): IncidentEventDto => ({
        id: e.id,
        eventType: e.eventType,
        actor: { id: e.actorId, name: e.actorName },
        metadata: e.metadata,
        createdAt: e.createdAt.toISOString(),
      })),
      comments: comments.map((c): IncidentCommentDto => ({
        id: c.id,
        body: c.body,
        author: { id: c.authorId, name: c.authorName },
        createdAt: c.createdAt.toISOString(),
      })),
    };
  },

  async create(
    ctx: RequestContext,
    input: {
      serviceId: string;
      title: string;
      description?: string;
      severity: Severity;
      priority?: Priority;
      assigneeId?: string;
    },
  ): Promise<IncidentDto> {
    const orgId = ctx.actor.organizationId;
    const incident = await db.transaction(async (tx) => {
      const service = await servicesRepository.find(tx, orgId, input.serviceId);
      if (!service) throw new NotFoundError('Service not found', 'SERVICE_NOT_FOUND');
      if (input.assigneeId) await requireAssignee(tx, ctx, input.assigneeId);

      const { id } = await repo.insert(tx, {
        organizationId: orgId,
        serviceId: input.serviceId,
        title: input.title,
        description: input.description,
        severity: input.severity,
        priority: input.priority,
        assignedTo: input.assigneeId,
        createdBy: ctx.actor.userId,
      });
      const metadata = { title: input.title, severity: input.severity, serviceId: input.serviceId };
      await repo.insertEvent(tx, {
        organizationId: orgId,
        incidentId: id,
        actorId: ctx.actor.userId,
        eventType: 'incident.created',
        metadata,
      });
      await auditRepository.insert(tx, ctx, {
        action: 'incident.created',
        resourceType: 'incident',
        resourceId: id,
        metadata,
      });
      return toDto(await requireIncident(tx, ctx, id));
    });
    await emitIncidentEvent(ctx, incident, 'created');
    return incident;
  },

  async update(
    ctx: RequestContext,
    id: string,
    input: {
      version: number;
      title?: string;
      description?: string | null;
      severity?: Severity;
      priority?: Priority;
    },
  ): Promise<IncidentDto> {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const incident = await db.transaction(async (tx) => {
      const current = await requireIncident(tx, ctx, id);
      const { version, ...fields } = input;
      for (const [key, to] of Object.entries(fields)) {
        const from = current[key as keyof Row];
        if (to !== undefined && to !== from) changes[key] = { from, to };
      }
      return applyChange(tx, ctx, current, version, fields, {
        type: 'incident.updated',
        metadata: { changes },
      });
    });
    await emitIncidentEvent(ctx, incident, 'updated', { changes });
    return incident;
  },

  async assign(
    ctx: RequestContext,
    id: string,
    input: { version: number; assigneeId: string | null },
  ): Promise<IncidentDto> {
    let previous: string | null = null;
    const incident = await db.transaction(async (tx) => {
      const current = await requireIncident(tx, ctx, id);
      previous = current.assigneeId;
      if (input.assigneeId) await requireAssignee(tx, ctx, input.assigneeId);
      return applyChange(
        tx,
        ctx,
        current,
        input.version,
        { assignedTo: input.assigneeId },
        {
          type: 'incident.assigned',
          metadata: { from: current.assigneeId, to: input.assigneeId },
        },
      );
    });
    await emitIncidentEvent(ctx, incident, 'assigned', { from: previous, to: input.assigneeId });
    return incident;
  },

  async changeStatus(
    ctx: RequestContext,
    id: string,
    input: { version: number; status: IncidentStatus },
  ): Promise<IncidentDto> {
    let from: IncidentStatus = 'OPEN';
    const incident = await db.transaction(async (tx) => {
      const current = await requireIncident(tx, ctx, id);
      from = current.status;
      // A stale version wins over an invalid transition: the client's view is outdated anyway.
      if (current.version !== input.version) throw versionConflict(current.version);
      assertTransition(current.status, input.status);
      return applyChange(
        tx,
        ctx,
        current,
        input.version,
        {
          status: input.status,
          ...(input.status === 'RESOLVED' ? { resolvedAt: new Date() } : {}),
        },
        { type: 'incident.status_changed', metadata: { from: current.status, to: input.status } },
      );
    });
    if (input.status === 'RESOLVED') await emitIncidentEvent(ctx, incident, 'resolved');
    else await emitIncidentEvent(ctx, incident, 'status_changed', { from, to: input.status });
    return incident;
  },

  async addComment(
    ctx: RequestContext,
    id: string,
    input: { body: string },
  ): Promise<IncidentCommentDto> {
    const orgId = ctx.actor.organizationId;
    let incident!: IncidentDto;
    const comment = await db.transaction(async (tx) => {
      incident = toDto(await requireIncident(tx, ctx, id));
      const { id: commentId } = await repo.insertComment(tx, {
        organizationId: orgId,
        incidentId: id,
        authorId: ctx.actor.userId,
        body: input.body,
      });
      await repo.insertEvent(tx, {
        organizationId: orgId,
        incidentId: id,
        actorId: ctx.actor.userId,
        eventType: 'incident.comment_added',
        metadata: { commentId },
      });
      await auditRepository.insert(tx, ctx, {
        action: 'incident.comment_added',
        resourceType: 'incident',
        resourceId: id,
        metadata: { commentId },
      });
      return {
        id: commentId,
        body: input.body,
        author: { id: ctx.actor.userId, name: ctx.actor.name },
        createdAt: new Date().toISOString(),
      };
    });
    await emitIncidentEvent(ctx, incident, 'comment_added', { commentId: comment.id });
    return comment;
  },
};
