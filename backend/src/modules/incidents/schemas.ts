import { z } from 'zod';
import { incidentStatuses, priorities, severities } from '@opsflow/shared';
import { PaginationSchema } from '../../lib/pagination';

const version = z.number().int().min(1);

export const CreateIncidentSchema = z.object({
  serviceId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  severity: z.enum(severities),
  priority: z.enum(priorities).optional(),
  assigneeId: z.string().uuid().optional(),
});

export const UpdateIncidentSchema = z
  .object({
    version,
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    severity: z.enum(severities).optional(),
    priority: z.enum(priorities).optional(),
  })
  .refine(
    (v) => ['title', 'description', 'severity', 'priority'].some((k) => k in v),
    'Provide at least one field to update',
  );

export const AssignIncidentSchema = z.object({ version, assigneeId: z.string().uuid().nullable() });
export const ChangeStatusSchema = z.object({ version, status: z.enum(incidentStatuses) });
export const AddCommentSchema = z.object({ body: z.string().trim().min(1).max(5000) });

export const ListIncidentsQuerySchema = PaginationSchema.extend({
  status: z.enum(incidentStatuses).optional(),
  severity: z.enum(severities).optional(),
  priority: z.enum(priorities).optional(),
  serviceId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListIncidentsQuery = z.infer<typeof ListIncidentsQuerySchema>;
