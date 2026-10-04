import { db } from '../db/client';
import { ForbiddenError, ValidationError } from './errors';
import { servicesRepository } from '../modules/services/repository';

type Item = Record<string, unknown>;

/**
 * Let callers refer to a service by slug ("payment-service") instead of a UUID, and let a key that is tied to
 * one service omit it entirely. Applies to a single object or a `{ logs: [...] }` batch. A key tied to a
 * service can never act on another one. The returned body is a copy; the request is not mutated.
 */
export async function resolveServiceRefs(
  organizationId: string,
  body: unknown,
  key: { serviceId: string | null } | undefined,
): Promise<unknown> {
  if (typeof body !== 'object' || body === null) return body;
  const copy = structuredClone(body) as Item & { logs?: unknown };
  const items: Item[] = Array.isArray(copy.logs)
    ? (copy.logs.filter((i) => typeof i === 'object' && i !== null) as Item[])
    : [copy];

  const bySlug = new Map<string, string>();
  for (const item of items) {
    let serviceId = typeof item.serviceId === 'string' ? item.serviceId : undefined;
    const slug = typeof item.service === 'string' ? item.service : undefined;
    if (slug && !serviceId) {
      let id = bySlug.get(slug);
      if (!id) {
        id = (await servicesRepository.findBySlug(db, organizationId, slug))?.id;
        if (!id)
          throw new ValidationError(
            `No service with slug "${slug}" in this organization`,
            { service: slug },
            'UNKNOWN_SERVICE',
          );
        bySlug.set(slug, id);
      }
      serviceId = id;
    }
    if (key?.serviceId) {
      if (serviceId && serviceId !== key.serviceId) {
        throw new ForbiddenError(
          'This API key is tied to a different service',
          'KEY_SERVICE_MISMATCH',
        );
      }
      serviceId = key.serviceId;
    }
    if (serviceId) item.serviceId = serviceId;
    delete item.service;
  }
  return copy;
}
