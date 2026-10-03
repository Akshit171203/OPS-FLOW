import type { z, ZodTypeAny } from 'zod';
import { ValidationError } from './errors';

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError('Invalid request', result.error.flatten());
  }
  return result.data;
}
