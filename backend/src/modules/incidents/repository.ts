import { and, asc, count, desc, eq, gte, inArray, lte, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Priority, Severity } from '@opsflow/shared';
import type { Executor } from '../../db/client';
import { incidentComments, incidentEvents, incidents, services, users } from '../../db/schema';
import { offsetOf } from '../../lib/pagination';
import type { ListIncidentsQuery } from './schemas';

const assignee = alias(users, 'assignee');

const when = <T>(value: T | undefined, build: (v: T) => SQL): SQL | undefined =>
  value === undefined ? undefined : build(value);

const selection = {
  id: incidents.id,
  serviceId: incidents.serviceId,
  serviceName: services.name,
  title: incidents.title,
  description: incidents.description,
  severity: incidents.severity,
  status: incidents.status,
  priority: incidents.priority,
  assigneeId: assignee.id,
  assigneeName: assignee.name,
  assigneeEmail: assignee.email,
  createdBy: incidents.createdBy,
  startedAt: incidents.startedAt,
  resolvedAt: incidents.resolvedAt,
  version: incidents.version,
  source: incidents.source,
  alertFingerprint: incidents.alertFingerprint,
  createdAt: incidents.createdAt,
  updatedAt: incidents.updatedAt,
};

export type IncidentRow = Awaited<ReturnType<typeof incidentsRepository.find>>;

function base(ex: Executor) {
  return ex
    .select(selection)
    .from(incidents)
    .innerJoin(services, eq(services.id, incidents.serviceId))
    .leftJoin(assignee, eq(assignee.id, incidents.assignedTo));
}

export const incidentsRepository = {
  /** The open (not resolved or closed) incident raised by this alert fingerprint, if any. */
  async findOpenByFingerprint(ex: Executor, organizationId: string, fingerprint: string) {
    const [row] = await base(ex).where(
      and(
        eq(incidents.organizationId, organizationId),
        eq(incidents.alertFingerprint, fingerprint),
        sql`${incidents.status} NOT IN ('RESOLVED', 'CLOSED')`,
      ),
    );
    return row;
  },

  /** Past resolved incidents of a service, for "similar incidents" in AI analysis. */
  listResolvedForService(
    ex: Executor,
    organizationId: string,
    serviceId: string,
    excludeId: string,
    limit: number,
  ) {
    return ex
      .select({
        title: incidents.title,
        severity: incidents.severity,
        status: incidents.status,
        startedAt: incidents.startedAt,
        resolvedAt: incidents.resolvedAt,
      })
      .from(incidents)
      .where(
        and(
          eq(incidents.organizationId, organizationId),
          eq(incidents.serviceId, serviceId),
          ne(incidents.id, excludeId),
          inArray(incidents.status, ['RESOLVED', 'CLOSED']),
        ),
      )
      .orderBy(desc(incidents.startedAt))
      .limit(limit);
  },

  async find(ex: Executor, organizationId: string, id: string) {
    const [row] = await base(ex).where(
      and(eq(incidents.organizationId, organizationId), eq(incidents.id, id)),
    );
    return row;
  },

  async list(ex: Executor, organizationId: string, q: ListIncidentsQuery) {
    const where = and(
      eq(incidents.organizationId, organizationId),
      when(q.status, (v) => eq(incidents.status, v)),
      when(q.severity, (v) => eq(incidents.severity, v)),
      when(q.priority, (v) => eq(incidents.priority, v)),
      when(q.serviceId, (v) => eq(incidents.serviceId, v)),
      when(q.assigneeId, (v) => eq(incidents.assignedTo, v)),
      when(q.from, (v) => gte(incidents.startedAt, v)),
      when(q.to, (v) => lte(incidents.startedAt, v)),
    );
    const rows = await base(ex)
      .where(where)
      .orderBy(desc(incidents.startedAt), desc(incidents.id))
      .limit(q.limit)
      .offset(offsetOf(q));
    const [{ total } = { total: 0 }] = await ex
      .select({ total: count() })
      .from(incidents)
      .where(where);
    return { rows, total };
  },

  async insert(
    ex: Executor,
    v: {
      organizationId: string;
      serviceId: string;
      title: string;
      description?: string;
      severity: Severity;
      priority?: Priority;
      assignedTo?: string;
      createdBy: string;
      source?: string;
      alertFingerprint?: string;
    },
  ) {
    const [row] = await ex.insert(incidents).values(v).returning({ id: incidents.id });
    return row!;
  },

  /** Optimistic update: matches only if the caller's version is still current. */
  async updateIfVersion(
    ex: Executor,
    organizationId: string,
    id: string,
    version: number,
    set: Partial<typeof incidents.$inferInsert>,
  ) {
    const [row] = await ex
      .update(incidents)
      .set({ ...set, version: sql`${incidents.version} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(incidents.organizationId, organizationId),
          eq(incidents.id, id),
          eq(incidents.version, version),
        ),
      )
      .returning({ id: incidents.id });
    return row;
  },

  async insertEvent(
    ex: Executor,
    v: {
      organizationId: string;
      incidentId: string;
      actorId: string;
      eventType: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    await ex.insert(incidentEvents).values({ ...v, metadata: v.metadata ?? {} });
  },

  listEvents(ex: Executor, organizationId: string, incidentId: string) {
    return ex
      .select({
        id: incidentEvents.id,
        eventType: incidentEvents.eventType,
        actorId: users.id,
        actorName: users.name,
        metadata: incidentEvents.metadata,
        createdAt: incidentEvents.createdAt,
      })
      .from(incidentEvents)
      .innerJoin(users, eq(users.id, incidentEvents.actorId))
      .where(
        and(
          eq(incidentEvents.organizationId, organizationId),
          eq(incidentEvents.incidentId, incidentId),
        ),
      )
      .orderBy(asc(incidentEvents.createdAt), asc(incidentEvents.id));
  },

  async insertComment(
    ex: Executor,
    v: { organizationId: string; incidentId: string; authorId: string; body: string },
  ) {
    const [row] = await ex
      .insert(incidentComments)
      .values(v)
      .returning({ id: incidentComments.id });
    return row!;
  },

  listComments(ex: Executor, organizationId: string, incidentId: string) {
    return ex
      .select({
        id: incidentComments.id,
        body: incidentComments.body,
        authorId: users.id,
        authorName: users.name,
        createdAt: incidentComments.createdAt,
      })
      .from(incidentComments)
      .innerJoin(users, eq(users.id, incidentComments.authorId))
      .where(
        and(
          eq(incidentComments.organizationId, organizationId),
          eq(incidentComments.incidentId, incidentId),
        ),
      )
      .orderBy(asc(incidentComments.createdAt), asc(incidentComments.id));
  },
};
