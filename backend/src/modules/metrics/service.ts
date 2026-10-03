import type { MetricDto, ServiceStatus } from '@opsflow/shared';
import { db } from '../../db/client';
import type { metrics } from '../../db/schema';
import type { RequestContext } from '../../lib/context';
import { NotFoundError } from '../../lib/errors';
import { servicesRepository } from '../services/repository';
import { metricsRepository as repo } from './repository';
import type { IngestMetricInput } from './schemas';

const toDto = (r: typeof metrics.$inferSelect): MetricDto => ({
  id: r.id,
  serviceId: r.serviceId,
  errorRate: r.errorRate,
  latencyMs: r.latencyMs,
  requestsPerMin: r.requestsPerMin,
  healthStatus: r.healthStatus,
  capturedAt: r.capturedAt.toISOString(),
});

/** Derive a health label from the numbers when the sender does not provide one. */
export function deriveHealth(errorRate: number, latencyMs: number): ServiceStatus {
  if (errorRate >= 0.5) return 'DOWN';
  if (errorRate >= 0.05 || latencyMs >= 1000) return 'DEGRADED';
  return 'HEALTHY';
}

export const metricsService = {
  /** Records a snapshot and, if it is the newest one, mirrors its health onto the service. */
  async ingest(ctx: RequestContext, input: IngestMetricInput): Promise<MetricDto> {
    const orgId = ctx.actor.organizationId;
    return db.transaction(async (tx) => {
      if (!(await servicesRepository.find(tx, orgId, input.serviceId))) {
        throw new NotFoundError('Service not found', 'SERVICE_NOT_FOUND');
      }
      const capturedAt = input.capturedAt ?? new Date();
      const previous = await repo.latest(tx, orgId, input.serviceId);
      const row = await repo.insert(tx, {
        organizationId: orgId,
        serviceId: input.serviceId,
        errorRate: input.errorRate,
        latencyMs: input.latencyMs,
        requestsPerMin: input.requestsPerMin,
        healthStatus: input.healthStatus ?? deriveHealth(input.errorRate, input.latencyMs),
        capturedAt,
      });
      if (!previous || capturedAt >= previous.capturedAt) {
        await repo.setServiceStatus(tx, orgId, input.serviceId, row.healthStatus);
      }
      return toDto(row);
    });
  },

  async latest(ctx: RequestContext, serviceId: string): Promise<MetricDto | null> {
    const orgId = ctx.actor.organizationId;
    if (!(await servicesRepository.find(db, orgId, serviceId))) {
      throw new NotFoundError('Service not found', 'SERVICE_NOT_FOUND');
    }
    const row = await repo.latest(db, orgId, serviceId);
    return row ? toDto(row) : null;
  },
};
