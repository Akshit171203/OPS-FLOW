import type { DeploymentDto, Paginated } from '@opsflow/shared';
import { db } from '../../db/client';
import type { RequestContext } from '../../lib/context';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { paginated, type Pagination } from '../../lib/pagination';
import { invalidateOrgViews } from '../../lib/cache';
import { auditRepository } from '../audit/repository';
import { emitIncidentRealtime } from '../incidents/events';
import { incidentsRepository } from '../incidents/repository';
import { toIncidentDto } from '../incidents/service';
import { servicesRepository } from '../services/repository';
import { deploymentsRepository as repo } from './repository';
import type { CreateDeploymentInput } from './schemas';

type Row = NonNullable<Awaited<ReturnType<typeof repo.find>>>;
const toDto = (r: Row & { linked?: boolean }): DeploymentDto => ({
  ...r,
  deployedAt: r.deployedAt.toISOString(),
});

export const deploymentsService = {
  async create(ctx: RequestContext, input: CreateDeploymentInput): Promise<DeploymentDto> {
    const orgId = ctx.actor.organizationId;
    const created = await db.transaction(async (tx) => {
      if (!(await servicesRepository.find(tx, orgId, input.serviceId))) {
        throw new NotFoundError('Service not found', 'SERVICE_NOT_FOUND');
      }
      const { id } = await repo.insert(tx, {
        organizationId: orgId,
        serviceId: input.serviceId,
        version: input.version,
        commitSha: input.commitSha,
        environment: input.environment,
        deployedBy: input.deployedBy ?? ctx.actor.name,
        deployedAt: input.deployedAt ?? new Date(),
        status: input.status,
      });
      await auditRepository.insert(tx, ctx, {
        action: 'deployment.created',
        resourceType: 'deployment',
        resourceId: id,
        metadata: { serviceId: input.serviceId, version: input.version, status: input.status },
      });
      return toDto((await repo.find(tx, orgId, id))!);
    });
    await invalidateOrgViews(orgId); // the dashboard lists recent deployments
    return created;
  },

  async list(
    ctx: RequestContext,
    p: Pagination,
    serviceId?: string,
  ): Promise<Paginated<DeploymentDto>> {
    const { rows, total } = await repo.list(db, ctx.actor.organizationId, p, serviceId);
    return paginated(rows.map(toDto), total, p);
  },

  async listForIncident(ctx: RequestContext, incidentId: string, windowHours: number) {
    const orgId = ctx.actor.organizationId;
    const incident = await incidentsRepository.find(db, orgId, incidentId);
    if (!incident) throw new NotFoundError('Incident not found', 'INCIDENT_NOT_FOUND');
    const since = new Date(incident.startedAt.getTime() - windowHours * 3_600_000);
    const rows = await repo.listForIncident(db, orgId, incidentId, incident.serviceId, since);
    return { deployments: rows.map(toDto), windowHours };
  },

  /** Link a deployment to an incident; writes a timeline event and an audit log in one transaction. */
  async linkToIncident(ctx: RequestContext, incidentId: string, deploymentId: string) {
    const orgId = ctx.actor.organizationId;
    const incident = await db.transaction(async (tx) => {
      const current = await incidentsRepository.find(tx, orgId, incidentId);
      if (!current) throw new NotFoundError('Incident not found', 'INCIDENT_NOT_FOUND');
      const deployment = await repo.find(tx, orgId, deploymentId);
      if (!deployment) throw new NotFoundError('Deployment not found', 'DEPLOYMENT_NOT_FOUND');
      if (deployment.serviceId !== current.serviceId) {
        throw new ValidationError(
          'Deployment belongs to a different service than the incident',
          undefined,
          'DEPLOYMENT_SERVICE_MISMATCH',
        );
      }
      const linked = await repo.link(tx, {
        incidentId,
        deploymentId,
        organizationId: orgId,
        linkedBy: ctx.actor.userId,
      });
      if (!linked)
        throw new ConflictError('Deployment is already linked to this incident', 'ALREADY_LINKED');

      const metadata = {
        deploymentId,
        version: deployment.version,
        commitSha: deployment.commitSha,
      };
      await incidentsRepository.insertEvent(tx, {
        organizationId: orgId,
        incidentId,
        actorId: ctx.actor.userId,
        eventType: 'incident.deployment_linked',
        metadata,
      });
      await auditRepository.insert(tx, ctx, {
        action: 'incident.deployment_linked',
        resourceType: 'incident',
        resourceId: incidentId,
        metadata,
      });
      return toIncidentDto((await incidentsRepository.find(tx, orgId, incidentId))!);
    });
    await emitIncidentRealtime(ctx, incident, 'updated');
    return incident;
  },
};
