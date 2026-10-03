import { and, desc, eq, inArray, isNotNull, notInArray, sql } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { deployments, incidents, services } from '../../db/schema';

export const dashboardRepository = {
  async countOpen(ex: Executor, organizationId: string, onlyCritical: boolean): Promise<number> {
    const [row] = await ex
      .select({ n: sql<number>`count(*)::int` })
      .from(incidents)
      .where(
        and(
          eq(incidents.organizationId, organizationId),
          notInArray(incidents.status, ['RESOLVED', 'CLOSED']),
          onlyCritical ? eq(incidents.severity, 'SEV1') : undefined,
        ),
      );
    return row?.n ?? 0;
  },

  degradedServices(ex: Executor, organizationId: string) {
    return ex
      .select({ id: services.id, name: services.name, status: services.status })
      .from(services)
      .where(
        and(
          eq(services.organizationId, organizationId),
          inArray(services.status, ['DEGRADED', 'DOWN']),
        ),
      )
      .orderBy(services.name);
  },

  recentDeployments(ex: Executor, organizationId: string, limit: number) {
    return ex
      .select({
        id: deployments.id,
        serviceId: deployments.serviceId,
        serviceName: services.name,
        version: deployments.version,
        commitSha: deployments.commitSha,
        environment: deployments.environment,
        deployedBy: deployments.deployedBy,
        deployedAt: deployments.deployedAt,
        status: deployments.status,
      })
      .from(deployments)
      .innerJoin(services, eq(services.id, deployments.serviceId))
      .where(eq(deployments.organizationId, organizationId))
      .orderBy(desc(deployments.deployedAt), desc(deployments.id))
      .limit(limit);
  },

  /** Average minutes from start to resolution, computed in SQL. */
  async avgResolutionMinutes(ex: Executor, organizationId: string): Promise<number | null> {
    const [row] = await ex
      .select({
        avg: sql<
          number | null
        >`avg(extract(epoch from (${incidents.resolvedAt} - ${incidents.startedAt})) / 60)::float8`,
      })
      .from(incidents)
      .where(and(eq(incidents.organizationId, organizationId), isNotNull(incidents.resolvedAt)));
    return row?.avg ?? null;
  },
};
