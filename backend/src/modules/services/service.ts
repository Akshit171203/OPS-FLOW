import type { Paginated, ServiceDto, ServiceStatus } from '@opsflow/shared';
import { db } from '../../db/client';
import type { RequestContext } from '../../lib/context';
import { isUniqueViolation } from '../../lib/dbErrors';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { paginated, type Pagination } from '../../lib/pagination';
import { auditRepository } from '../audit/repository';
import { projectsRepository } from '../projects/repository';
import { servicesRepository as repo } from './repository';

type Row = NonNullable<Awaited<ReturnType<typeof repo.find>>>;

const toDto = (r: Row): ServiceDto => ({ ...r, createdAt: r.createdAt.toISOString() });

export const servicesService = {
  async list(
    ctx: RequestContext,
    p: Pagination,
    projectId?: string,
  ): Promise<Paginated<ServiceDto>> {
    const { rows, total } = await repo.list(db, ctx.actor.organizationId, p, projectId);
    return paginated(rows.map(toDto), total, p);
  },

  async create(
    ctx: RequestContext,
    input: { projectId: string; name: string; slug: string; status?: ServiceStatus },
  ) {
    const orgId = ctx.actor.organizationId;
    try {
      return await db.transaction(async (tx) => {
        const project = await projectsRepository.find(tx, orgId, input.projectId);
        if (!project) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
        const { id } = await repo.insert(tx, { organizationId: orgId, ...input });
        await auditRepository.insert(tx, ctx, {
          action: 'service.created',
          resourceType: 'service',
          resourceId: id,
          metadata: { name: input.name, slug: input.slug, projectId: input.projectId },
        });
        return toDto((await repo.find(tx, orgId, id))!);
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError('Service slug already in use in this project', 'SLUG_TAKEN');
      }
      throw err;
    }
  },

  async update(ctx: RequestContext, id: string, input: { name?: string; status?: ServiceStatus }) {
    const orgId = ctx.actor.organizationId;
    return db.transaction(async (tx) => {
      const updated = await repo.update(tx, orgId, id, input);
      if (!updated) throw new NotFoundError('Service not found', 'SERVICE_NOT_FOUND');
      await auditRepository.insert(tx, ctx, {
        action: 'service.updated',
        resourceType: 'service',
        resourceId: id,
        metadata: { changes: input },
      });
      return toDto((await repo.find(tx, orgId, id))!);
    });
  },
};
