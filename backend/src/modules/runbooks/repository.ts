import { and, count, cosineDistance, desc, eq, sql } from 'drizzle-orm';
import type { RunbookIndexStatus } from '@opsflow/shared';
import type { Executor } from '../../db/client';
import { runbookChunks, runbooks } from '../../db/schema';
import { offsetOf, type Pagination } from '../../lib/pagination';

export type RunbookRow = typeof runbooks.$inferSelect;

export interface ChunkHit {
  runbookId: string;
  runbookTitle: string;
  chunkIndex: number;
  content: string;
  score: number;
}

export const runbooksRepository = {
  async insert(
    ex: Executor,
    v: {
      organizationId: string;
      title: string;
      content: string;
      serviceTag?: string | null;
      createdBy: string;
    },
  ) {
    // updatedAt is set from JavaScript (millisecond precision) because the indexer compares it to detect edits mid-index
    const [row] = await ex
      .insert(runbooks)
      .values({ ...v, updatedAt: new Date() })
      .returning();
    return row!;
  },

  async find(ex: Executor, organizationId: string, id: string) {
    const [row] = await ex
      .select()
      .from(runbooks)
      .where(and(eq(runbooks.organizationId, organizationId), eq(runbooks.id, id)));
    return row;
  },

  async list(ex: Executor, organizationId: string, p: Pagination) {
    const where = eq(runbooks.organizationId, organizationId);
    const rows = await ex
      .select({
        runbook: runbooks,
        // Written with explicit table names: in a single-table select drizzle drops column prefixes,
        // which would make `runbook_id = id` compare the chunk's own id inside this subquery.
        chunkCount: sql<number>`(SELECT count(*)::int FROM runbook_chunks rc WHERE rc.runbook_id = "runbooks"."id")`,
      })
      .from(runbooks)
      .where(where)
      .orderBy(desc(runbooks.createdAt), desc(runbooks.id))
      .limit(p.limit)
      .offset(offsetOf(p));
    const [{ total } = { total: 0 }] = await ex
      .select({ total: count() })
      .from(runbooks)
      .where(where);
    return { rows, total };
  },

  async chunkCount(ex: Executor, runbookId: string): Promise<number> {
    const [row] = await ex
      .select({ n: count() })
      .from(runbookChunks)
      .where(eq(runbookChunks.runbookId, runbookId));
    return row?.n ?? 0;
  },

  /** Edit content: the runbook goes back to PENDING until it is re-indexed. */
  async update(
    ex: Executor,
    organizationId: string,
    id: string,
    set: { title?: string; content?: string; serviceTag?: string | null },
  ) {
    const [row] = await ex
      .update(runbooks)
      .set({ ...set, indexStatus: 'PENDING', indexError: null, updatedAt: new Date() })
      .where(and(eq(runbooks.organizationId, organizationId), eq(runbooks.id, id)))
      .returning();
    return row;
  },

  async markAllPending(ex: Executor, organizationId: string) {
    return ex
      .update(runbooks)
      .set({ indexStatus: 'PENDING', indexError: null, updatedAt: new Date() })
      .where(eq(runbooks.organizationId, organizationId))
      .returning({ id: runbooks.id, updatedAt: runbooks.updatedAt });
  },

  async setStatus(ex: Executor, id: string, status: RunbookIndexStatus, error: string | null) {
    await ex
      .update(runbooks)
      .set({ indexStatus: status, indexError: error })
      .where(eq(runbooks.id, id));
  },

  /**
   * Replace every chunk of a runbook, but only if the runbook has not been edited since `expectedUpdatedAt`
   * (an edit queues its own newer job). Returns false when the content changed and nothing was written.
   */
  async replaceChunks(
    ex: Executor,
    runbook: { id: string; organizationId: string; updatedAt: Date },
    chunks: { chunkIndex: number; content: string; embedding: number[] }[],
    embeddingModel: string,
  ): Promise<boolean> {
    const claimed = await ex
      .update(runbooks)
      .set({ indexStatus: 'INDEXED', indexError: null, indexedAt: new Date() })
      .where(and(eq(runbooks.id, runbook.id), eq(runbooks.updatedAt, runbook.updatedAt)))
      .returning({ id: runbooks.id });
    if (claimed.length === 0) return false;
    await ex.delete(runbookChunks).where(eq(runbookChunks.runbookId, runbook.id));
    if (chunks.length) {
      await ex.insert(runbookChunks).values(
        chunks.map((c) => ({
          organizationId: runbook.organizationId,
          runbookId: runbook.id,
          embeddingModel,
          ...c,
        })),
      );
    }
    return true;
  },

  /** Nearest chunks by cosine similarity, restricted to this organization and to vectors from the same model. */
  async searchChunks(
    ex: Executor,
    organizationId: string,
    vector: number[],
    embeddingModel: string,
    limit: number,
  ): Promise<ChunkHit[]> {
    const distance = cosineDistance(runbookChunks.embedding, vector);
    const rows = await ex
      .select({
        runbookId: runbookChunks.runbookId,
        runbookTitle: runbooks.title,
        chunkIndex: runbookChunks.chunkIndex,
        content: runbookChunks.content,
        score: sql<number>`1 - (${distance})`,
      })
      .from(runbookChunks)
      .innerJoin(runbooks, eq(runbooks.id, runbookChunks.runbookId))
      .where(
        and(
          eq(runbookChunks.organizationId, organizationId),
          eq(runbookChunks.embeddingModel, embeddingModel),
        ),
      )
      .orderBy(distance)
      .limit(limit);
    return rows.map((r) => ({ ...r, score: Number(r.score) }));
  },
};
