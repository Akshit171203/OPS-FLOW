import { and, desc, eq, sql } from 'drizzle-orm';
import type { ServiceStatus } from '@opsflow/shared';
import type { Executor } from '../../db/client';
import { metrics, services } from '../../db/schema';

export const metricsRepository = {
  async insert(
    ex: Executor,
    v: {
      organizationId: string;
      serviceId: string;
      errorRate: number;
      latencyMs: number;
      requestsPerMin: number;
      healthStatus: ServiceStatus;
      capturedAt: Date;
    },
  ) {
    const [row] = await ex.insert(metrics).values(v).returning();
    return row!;
  },

  async latest(ex: Executor, organizationId: string, serviceId: string) {
    const [row] = await ex
      .select()
      .from(metrics)
      .where(and(eq(metrics.organizationId, organizationId), eq(metrics.serviceId, serviceId)))
      .orderBy(desc(metrics.capturedAt), desc(metrics.id))
      .limit(1);
    return row;
  },

  /** Newest snapshots first, for the analysis context. */
  recent(ex: Executor, organizationId: string, serviceId: string, limit: number) {
    return ex
      .select()
      .from(metrics)
      .where(and(eq(metrics.organizationId, organizationId), eq(metrics.serviceId, serviceId)))
      .orderBy(desc(metrics.capturedAt), desc(metrics.id))
      .limit(limit);
  },

  async setServiceStatus(
    ex: Executor,
    organizationId: string,
    serviceId: string,
    status: ServiceStatus,
  ) {
    await ex
      .update(services)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(services.organizationId, organizationId), eq(services.id, serviceId)));
  },
};

export interface ServiceHealthRow {
  id: string;
  name: string;
  project_name: string;
  status: ServiceStatus;
  metric_id: string | null;
  error_rate: number | null;
  latency_ms: number | null;
  requests_per_min: number | null;
  health_status: ServiceStatus | null;
  captured_at: Date | null;
}

/** Every service with its single newest snapshot (one query, DISTINCT ON instead of N+1). */
export async function listServiceHealth(
  ex: Executor,
  organizationId: string,
): Promise<ServiceHealthRow[]> {
  const result = await (
    ex as unknown as { execute: (q: unknown) => Promise<{ rows: ServiceHealthRow[] }> }
  ).execute(sql`
    SELECT s.id, s.name, p.name AS project_name, s.status,
           m.id AS metric_id, m.error_rate, m.latency_ms, m.requests_per_min, m.health_status, m.captured_at
    FROM services s
    JOIN projects p ON p.id = s.project_id
    LEFT JOIN LATERAL (
      SELECT * FROM metrics WHERE metrics.service_id = s.id ORDER BY captured_at DESC, id DESC LIMIT 1
    ) m ON true
    WHERE s.organization_id = ${organizationId}
    ORDER BY s.name
  `);
  return result.rows;
}
