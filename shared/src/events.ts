import { z } from 'zod';
import { severities } from './enums';

const base = {
  eventId: z.string().uuid(),
  organizationId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  /** The x-request-id of the HTTP request that caused the event, for end-to-end tracing. */
  requestId: z.string().min(1).max(128),
};

const incidentFacts = {
  incidentId: z.string().uuid(),
  title: z.string(),
  actorId: z.string().uuid(),
  assigneeId: z.string().uuid().nullable(),
  createdBy: z.string().uuid(),
};

export const IncidentCreatedSchema = z.object({
  ...base,
  type: z.literal('incident.created'),
  payload: z.object({
    ...incidentFacts,
    severity: z.enum(severities),
    serviceId: z.string().uuid(),
  }),
});

export const incidentChanges = ['updated', 'assigned', 'status_changed', 'comment_added'] as const;
export const IncidentUpdatedSchema = z.object({
  ...base,
  type: z.literal('incident.updated'),
  payload: z.object({
    ...incidentFacts,
    change: z.enum(incidentChanges),
    details: z.record(z.unknown()).default({}),
  }),
});

export const IncidentResolvedSchema = z.object({
  ...base,
  type: z.literal('incident.resolved'),
  payload: z.object(incidentFacts),
});

export const NotificationRequestedSchema = z.object({
  ...base,
  type: z.literal('notification.requested'),
  payload: z.object({
    userId: z.string().uuid(),
    notificationType: z.string().min(1).max(100),
    message: z.string().min(1).max(500),
    incidentId: z.string().uuid().optional(),
  }),
});

export const AppEventSchema = z.discriminatedUnion('type', [
  IncidentCreatedSchema,
  IncidentUpdatedSchema,
  IncidentResolvedSchema,
  NotificationRequestedSchema,
]);

export type IncidentCreated = z.infer<typeof IncidentCreatedSchema>;
export type IncidentUpdated = z.infer<typeof IncidentUpdatedSchema>;
export type IncidentResolved = z.infer<typeof IncidentResolvedSchema>;
export type NotificationRequested = z.infer<typeof NotificationRequestedSchema>;
export type AppEvent = z.infer<typeof AppEventSchema>;
export type AppEventType = AppEvent['type'];

export interface NotificationDto {
  id: string;
  type: string;
  message: string;
  incidentId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface FailedJobDto {
  jobId: string;
  eventId: string;
  type: string;
  requestId: string;
  attemptsMade: number;
  failedReason: string;
  failedAt: string | null;
}
