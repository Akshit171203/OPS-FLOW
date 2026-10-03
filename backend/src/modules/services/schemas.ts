import { z } from 'zod';
import { serviceStatuses } from '@opsflow/shared';
import { PaginationSchema } from '../../lib/pagination';
import { slugSchema } from '../projects/schemas';

export const CreateServiceSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  slug: slugSchema,
  status: z.enum(serviceStatuses).optional(),
});

export const UpdateServiceSchema = z
  .object({ name: z.string().trim().min(1).max(100), status: z.enum(serviceStatuses) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export const ListServicesQuerySchema = PaginationSchema.extend({
  projectId: z.string().uuid().optional(),
});
