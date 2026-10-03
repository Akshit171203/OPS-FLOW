import { z } from 'zod';

export const slugSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters, numbers and hyphens only');

export const CreateProjectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: slugSchema,
  description: z.string().max(1000).optional(),
});

export const UpdateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(1000).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export const IdParamsSchema = z.object({ id: z.string().uuid() });
