import type { MetricDto, MetricSeriesDto, ServiceHealthDto, ServiceStatus } from '@opsflow/shared';
import { db } from '../../db/client';
import type { metrics } from '../../db/schema';
import type { RequestContext } from '../../lib/context';
import { NotFoundError } from '../../lib/errors';
import { servicesRepository } from '../services/repository';
import { cacheKeys, getOrSet, invalidateOrgViews } from '../../lib/cache';
import { listServiceHealth, metricsRepository as repo } from './repository';
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
    const metric = await db.transaction(async (tx) => {
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
    await invalidateOrgViews(orgId); // service health and the dashboard's degraded list changed
    return metric;
  },

  /** Every service with its latest snapshot, cached for 15 seconds. */
  serviceHealth(ctx: RequestContext): Promise<ServiceHealthDto[]> {
    const orgId = ctx.actor.organizationId;
    return getOrSet(cacheKeys.serviceHealth(orgId), 15, async () =>
      (await listServiceHealth(db, orgId)).map((r) => ({
        id: r.id,
        name: r.name,
        projectName: r.project_name,
        status: r.status,
        latestMetric: r.metric_id
          ? {
              id: r.metric_id,
              serviceId: r.id,
              errorRate: r.error_rate!,
              latencyMs: r.latency_ms!,
              requestsPerMin: r.requests_per_min!,
              healthStatus: r.health_status!,
              capturedAt: new Date(r.captured_at!).toISOString(),
            }
          : null,
      })),
    );
  },

  /** Time series for a chart: the last `hours` of snapshots, oldest first (at most 500 points). */
  async series(ctx: RequestContext, serviceId: string, hours: number): Promise<MetricSeriesDto> {
    const orgId = ctx.actor.organizationId;
    if (!(await servicesRepository.find(db, orgId, serviceId))) {
      throw new NotFoundError('Service not found', 'SERVICE_NOT_FOUND');
    }
    const rows = await repo.series(
      db,
      orgId,
      serviceId,
      new Date(Date.now() - hours * 3_600_000),
      500,
    );
    return { serviceId, hours, points: rows.map(toDto) };
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
