import { z } from 'zod';
import type { Paginated } from '@opsflow/shared';

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof PaginationSchema>;

export const offsetOf = (p: Pagination) => (p.page - 1) * p.limit;

export function paginated<T>(items: T[], total: number, p: Pagination): Paginated<T> {
  return { items, page: p.page, limit: p.limit, total };
}
