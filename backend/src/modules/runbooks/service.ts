import type { Paginated, RunbookDto } from '@opsflow/shared';
import { db } from '../../db/client';
import { getRunbookQueue } from '../../events/queues';
import type { RequestContext } from '../../lib/context';
import { NotFoundError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { paginated, type Pagination } from '../../lib/pagination';
import { auditRepository } from '../audit/repository';
import { runbooksRepository as repo, type RunbookRow } from './repository';

const toDto = (r: RunbookRow, chunkCount: number, withContent = false): RunbookDto => ({
  id: r.id,
  title: r.title,
  ...(withContent ? { content: r.content } : {}),
  serviceTag: r.serviceTag,
  indexStatus: r.indexStatus,
  indexError: r.indexError,
  chunkCount,
  indexedAt: r.indexedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

/**
 * Queue an indexing job after the change has committed. One job per version of the text (keyed by its
 * updatedAt) so an edit is never swallowed by the de-duplication of an earlier job. If queuing fails the
 * runbook simply stays PENDING and can be re-indexed; the save itself is not lost.
 */
async function enqueueIndexing(ctx: RequestContext, runbook: { id: string; updatedAt: Date }) {
  try {
    await getRunbookQueue().add(
      'index-runbook',
      { runbookId: runbook.id, organizationId: ctx.actor.organizationId, requestId: ctx.requestId },
      { jobId: `${runbook.id}-${runbook.updatedAt.getTime()}` },
    );
  } catch (err) {
    logger.error({ err, runbook_id: runbook.id }, 'failed to queue runbook indexing');
  }
}

export const runbooksService = {
  async list(ctx: RequestContext, p: Pagination): Promise<Paginated<RunbookDto>> {
    const { rows, total } = await repo.list(db, ctx.actor.organizationId, p);
    return paginated(
      rows.map((r) => toDto(r.runbook, r.chunkCount)),
      total,
      p,
    );
  },

  async get(ctx: RequestContext, id: string): Promise<RunbookDto> {
    const row = await repo.find(db, ctx.actor.organizationId, id);
    if (!row) throw new NotFoundError('Runbook not found', 'RUNBOOK_NOT_FOUND');
    return toDto(row, await repo.chunkCount(db, id), true);
  },

  async create(
    ctx: RequestContext,
    input: { title: string; content: string; serviceTag?: string },
  ): Promise<RunbookDto> {
    const row = await db.transaction(async (tx) => {
      const created = await repo.insert(tx, {
        organizationId: ctx.actor.organizationId,
        title: input.title,
        content: input.content,
        serviceTag: input.serviceTag ?? null,
        createdBy: ctx.actor.userId,
      });
      await auditRepository.insert(tx, ctx, {
        action: 'runbook.created',
        resourceType: 'runbook',
        resourceId: created.id,
        metadata: { title: created.title },
      });
      return created;
    });
    await enqueueIndexing(ctx, row);
    return toDto(row, 0);
  },

  async update(
    ctx: RequestContext,
    id: string,
    input: { title?: string; content?: string; serviceTag?: string | null },
  ): Promise<RunbookDto> {
    const row = await db.transaction(async (tx) => {
      const updated = await repo.update(tx, ctx.actor.organizationId, id, input);
      if (!updated) throw new NotFoundError('Runbook not found', 'RUNBOOK_NOT_FOUND');
      await auditRepository.insert(tx, ctx, {
        action: 'runbook.updated',
        resourceType: 'runbook',
        resourceId: id,
        metadata: { fields: Object.keys(input) },
      });
      return updated;
    });
    await enqueueIndexing(ctx, row);
    return toDto(row, await repo.chunkCount(db, id));
  },

  /** Re-embed everything, for example after switching AI provider (embeddings from different models are not comparable). */
  async reindexAll(ctx: RequestContext): Promise<{ queued: number }> {
    const rows = await repo.markAllPending(db, ctx.actor.organizationId);
    for (const r of rows) await enqueueIndexing(ctx, r);
    return { queued: rows.length };
  },
};
