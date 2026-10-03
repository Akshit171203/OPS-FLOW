import { and, desc, eq } from 'drizzle-orm';
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
