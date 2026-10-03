import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  deploymentStatuses,
  incidentStatuses,
  logLevels,
  priorities,
  roles,
  serviceStatuses,
  severities,
} from '@opsflow/shared';

export const roleEnum = pgEnum('role', roles);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const organizationMembers = pgTable(
  'organization_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('organization_members_org_user_unique').on(t.organizationId, t.userId)],
);

export const serviceStatusEnum = pgEnum('service_status', serviceStatuses);
export const severityEnum = pgEnum('severity', severities);
export const incidentStatusEnum = pgEnum('incident_status', incidentStatuses);
export const priorityEnum = pgEnum('priority', priorities);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const orgId = () =>
  uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' });

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('projects_org_slug_unique').on(t.organizationId, t.slug)],
);

export const services = pgTable(
  'services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: serviceStatusEnum('status').notNull().default('UNKNOWN'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('services_project_slug_unique').on(t.projectId, t.slug)],
);

export const incidents = pgTable(
  'incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    severity: severityEnum('severity').notNull(),
    status: incidentStatusEnum('status').notNull().default('OPEN'),
    priority: priorityEnum('priority').notNull().default('MEDIUM'),
    assignedTo: uuid('assigned_to').references(() => users.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('incidents_org_status_idx').on(t.organizationId, t.status),
    index('incidents_service_created_idx').on(t.serviceId, t.createdAt),
    check(
      'incidents_resolved_at_check',
      sql`${t.resolvedAt} IS NULL OR ${t.status} IN ('RESOLVED', 'CLOSED')`,
    ),
  ],
);

export const incidentEvents = pgTable(
  'incident_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    eventType: text('event_type').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('incident_events_incident_created_idx').on(t.incidentId, t.createdAt)],
);

export const incidentComments = pgTable('incident_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: orgId(),
  incidentId: uuid('incident_id')
    .notNull()
    .references(() => incidents.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id')
    .notNull()
    .references(() => users.id),
  body: text('body').notNull(),
  createdAt: createdAt(),
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_org_created_idx').on(t.organizationId, t.createdAt)],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    scope: text('scope').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('idempotency_keys_key_scope_unique').on(t.key, t.scope)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The event that produced this notification; with user_id it is a second duplicate guard. */
    eventId: uuid('event_id').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<{ message: string; incidentId?: string | null }>().notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('notifications_event_user_unique').on(t.eventId, t.userId),
    index('notifications_user_created_idx').on(t.userId, t.createdAt),
  ],
);

export const logLevelEnum = pgEnum('log_level', logLevels);
export const deploymentStatusEnum = pgEnum('deployment_status', deploymentStatuses);

export const logs = pgTable(
  'logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    incidentId: uuid('incident_id').references(() => incidents.id, { onDelete: 'set null' }),
    level: logLevelEnum('level').notNull(),
    message: text('message').notNull(),
    requestId: text('request_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('logs_service_timestamp_idx').on(t.serviceId, t.timestamp),
    index('logs_incident_timestamp_idx').on(t.incidentId, t.timestamp),
    index('logs_org_timestamp_idx').on(t.organizationId, t.timestamp),
  ],
);

export const metrics = pgTable(
  'metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    /** Fraction of failed requests, 0 to 1. */
    errorRate: doublePrecision('error_rate').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    requestsPerMin: integer('requests_per_min').notNull(),
    healthStatus: serviceStatusEnum('health_status').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('metrics_service_captured_idx').on(t.serviceId, t.capturedAt),
    check('metrics_error_rate_check', sql`${t.errorRate} >= 0 AND ${t.errorRate} <= 1`),
  ],
);

export const deployments = pgTable(
  'deployments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    version: text('version').notNull(),
    commitSha: text('commit_sha').notNull(),
    environment: text('environment').notNull().default('production'),
    deployedBy: text('deployed_by').notNull(),
    deployedAt: timestamp('deployed_at', { withTimezone: true }).notNull().defaultNow(),
    status: deploymentStatusEnum('status').notNull().default('SUCCESS'),
  },
  (t) => [index('deployments_service_deployed_idx').on(t.serviceId, t.deployedAt)],
);

export const incidentDeployments = pgTable(
  'incident_deployments',
  {
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    deploymentId: uuid('deployment_id')
      .notNull()
      .references(() => deployments.id, { onDelete: 'cascade' }),
    organizationId: orgId(),
    linkedBy: uuid('linked_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [unique('incident_deployments_unique').on(t.incidentId, t.deploymentId)],
);
