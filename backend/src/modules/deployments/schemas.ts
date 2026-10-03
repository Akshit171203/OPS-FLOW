import { z } from 'zod';
import { deploymentStatuses } from '@opsflow/shared';
import { PaginationSchema } from '../../lib/pagination';

export const CreateDeploymentSchema = z.object({
  serviceId: z.string().uuid(),
  version: z.string().trim().min(1).max(50),
  commitSha: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{7,40}$/i, 'hex commit sha, 7 to 40 characters'),
  environment: z.string().trim().min(1).max(50).default('production'),
  deployedBy: z.string().trim().min(1).max(100).optional(),
  deployedAt: z.coerce.date().optional(),
  status: z.enum(deploymentStatuses).default('SUCCESS'),
});
export type CreateDeploymentInput = z.infer<typeof CreateDeploymentSchema>;

export const ListDeploymentsQuerySchema = PaginationSchema.extend({
  serviceId: z.string().uuid().optional(),
});

export const IncidentDeploymentsQuerySchema = z.object({
  windowHours: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 14)
    .default(48),
});

export const LinkDeploymentSchema = z.object({ deploymentId: z.string().uuid() });
