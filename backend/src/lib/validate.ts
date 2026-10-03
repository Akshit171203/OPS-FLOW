import type { ZodType } from 'zod';
import { ValidationError } from './errors';

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError('Invalid request', result.error.flatten());
  }
  return result.data;
}
