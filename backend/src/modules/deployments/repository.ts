import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import type { DeploymentStatus } from '@opsflow/shared';
import type { Executor } from '../../db/client';
import { deployments, incidentDeployments, services } from '../../db/schema';
import { offsetOf, type Pagination } from '../../lib/pagination';

const selection = {
  id: deployments.id,
  serviceId: deployments.serviceId,
  serviceName: services.name,
  version: deployments.version,
  commitSha: deployments.commitSha,
  environment: deployments.environment,
  deployedBy: deployments.deployedBy,
  deployedAt: deployments.deployedAt,
  status: deployments.status,
};

export const deploymentsRepository = {
  async insert(
    ex: Executor,
    v: {
      organizationId: string;
      serviceId: string;
      version: string;
      commitSha: string;
      environment: string;
      deployedBy: string;
      deployedAt: Date;
      status: DeploymentStatus;
    },
  ) {
    const [row] = await ex.insert(deployments).values(v).returning({ id: deployments.id });
    return row!;
  },

  async find(ex: Executor, organizationId: string, id: string) {
    const [row] = await ex
      .select(selection)
      .from(deployments)
      .innerJoin(services, eq(services.id, deployments.serviceId))
      .where(and(eq(deployments.organizationId, organizationId), eq(deployments.id, id)));
    return row;
  },

  async list(ex: Executor, organizationId: string, p: Pagination, serviceId?: string) {
    const where = and(
      eq(deployments.organizationId, organizationId),
      serviceId ? eq(deployments.serviceId, serviceId) : undefined,
    );
    const rows = await ex
      .select(selection)
      .from(deployments)
      .innerJoin(services, eq(services.id, deployments.serviceId))
      .where(where)
      .orderBy(desc(deployments.deployedAt), desc(deployments.id))
      .limit(p.limit)
      .offset(offsetOf(p));
    const [{ total } = { total: 0 }] = await ex
      .select({ total: count() })
      .from(deployments)
      .where(where);
    return { rows, total };
  },

  /** Deployments of a service since `since`, flagged with whether they are linked to the incident. */
  listForIncident(
    ex: Executor,
    organizationId: string,
    incidentId: string,
    serviceId: string,
    since: Date,
  ) {
    return ex
      .select({
        ...selection,
        linked: sql<boolean>`${incidentDeployments.deploymentId} IS NOT NULL`,
      })
      .from(deployments)
      .innerJoin(services, eq(services.id, deployments.serviceId))
      .leftJoin(
        incidentDeployments,
        and(
          eq(incidentDeployments.deploymentId, deployments.id),
          eq(incidentDeployments.incidentId, incidentId),
        ),
      )
      .where(
        and(
          eq(deployments.organizationId, organizationId),
          eq(deployments.serviceId, serviceId),
          gte(deployments.deployedAt, since),
        ),
      )
      .orderBy(desc(deployments.deployedAt), desc(deployments.id));
  },

  async link(
    ex: Executor,
    v: { incidentId: string; deploymentId: string; organizationId: string; linkedBy: string },
  ) {
    const rows = await ex
      .insert(incidentDeployments)
      .values(v)
      .onConflictDoNothing()
      .returning({ deploymentId: incidentDeployments.deploymentId });
    return rows.length > 0;
  },
};
