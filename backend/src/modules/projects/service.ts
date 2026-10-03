import type { Paginated, ProjectDto } from '@opsflow/shared';
import { db } from '../../db/client';
import type { projects } from '../../db/schema';
import type { RequestContext } from '../../lib/context';
import { isUniqueViolation } from '../../lib/dbErrors';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { paginated, type Pagination } from '../../lib/pagination';
import { auditRepository } from '../audit/repository';
import { projectsRepository as repo } from './repository';

const toDto = (r: typeof projects.$inferSelect): ProjectDto => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  description: r.description,
  createdAt: r.createdAt.toISOString(),
});

export const projectsService = {
  async list(ctx: RequestContext, p: Pagination): Promise<Paginated<ProjectDto>> {
    const { rows, total } = await repo.list(db, ctx.actor.organizationId, p);
    return paginated(rows.map(toDto), total, p);
  },

  async create(ctx: RequestContext, input: { name: string; slug: string; description?: string }) {
    try {
      return await db.transaction(async (tx) => {
        const row = await repo.insert(tx, { organizationId: ctx.actor.organizationId, ...input });
        await auditRepository.insert(tx, ctx, {
          action: 'project.created',
          resourceType: 'project',
          resourceId: row.id,
          metadata: { name: row.name, slug: row.slug },
        });
        return toDto(row);
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictError('Project slug already in use', 'SLUG_TAKEN');
      throw err;
    }
  },

  async update(
    ctx: RequestContext,
    id: string,
    input: { name?: string; description?: string | null },
  ) {
    return db.transaction(async (tx) => {
      const row = await repo.update(tx, ctx.actor.organizationId, id, input);
      if (!row) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
      await auditRepository.insert(tx, ctx, {
        action: 'project.updated',
        resourceType: 'project',
        resourceId: id,
        metadata: { changes: input },
      });
      return toDto(row);
    });
  },
};
