import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { aiAnalyses } from '../../db/schema';

export type AnalysisRow = typeof aiAnalyses.$inferSelect;
const ACTIVE = ['QUEUED', 'RUNNING'] as const;

export interface Outcome {
  model?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  estimatedCost?: number;
}

export const analysisRepository = {
  async insert(
    ex: Executor,
    v: { organizationId: string; incidentId: string; promptVersion: string; createdBy: string },
  ) {
    const [row] = await ex.insert(aiAnalyses).values(v).returning();
    return row!;
  },

  async find(ex: Executor, organizationId: string, id: string) {
    const [row] = await ex
      .select()
      .from(aiAnalyses)
      .where(and(eq(aiAnalyses.organizationId, organizationId), eq(aiAnalyses.id, id)));
    return row;
  },

  async findActive(ex: Executor, organizationId: string, incidentId: string) {
    const [row] = await ex
      .select()
      .from(aiAnalyses)
      .where(
        and(
          eq(aiAnalyses.organizationId, organizationId),
          eq(aiAnalyses.incidentId, incidentId),
          inArray(aiAnalyses.status, [...ACTIVE]),
        ),
      );
    return row;
  },

  history(ex: Executor, organizationId: string, incidentId: string, limit: number) {
    return ex
      .select()
      .from(aiAnalyses)
      .where(
        and(eq(aiAnalyses.organizationId, organizationId), eq(aiAnalyses.incidentId, incidentId)),
      )
      .orderBy(desc(aiAnalyses.createdAt), desc(aiAnalyses.id))
      .limit(limit);
  },

  /** QUEUED -> RUNNING. Returns the row only for the attempt that made the transition. */
  async claimStart(ex: Executor, organizationId: string, id: string) {
    const [row] = await ex
      .update(aiAnalyses)
      .set({ status: 'RUNNING', startedAt: new Date() })
      .where(
        and(
          eq(aiAnalyses.organizationId, organizationId),
          eq(aiAnalyses.id, id),
          eq(aiAnalyses.status, 'QUEUED'),
        ),
      )
      .returning();
    return row;
  },

  /** Terminal write, allowed only while the analysis is still active, so a late duplicate cannot overwrite it. */
  async complete(
    ex: Executor,
    id: string,
    result: Record<string, unknown>,
    o: Outcome & { model: string },
  ) {
    const [row] = await ex
      .update(aiAnalyses)
      .set({
        status: 'COMPLETED',
        result,
        errorCode: null,
        errorMessage: null,
        completedAt: new Date(),
        model: o.model,
        inputTokens: o.inputTokens ?? 0,
        outputTokens: o.outputTokens ?? 0,
        latencyMs: o.latencyMs ?? 0,
        estimatedCost: String(o.estimatedCost ?? 0),
      })
      .where(and(eq(aiAnalyses.id, id), inArray(aiAnalyses.status, [...ACTIVE])))
      .returning();
    return row;
  },

  async fail(ex: Executor, id: string, error: { code: string; message: string }, o: Outcome = {}) {
    const [row] = await ex
      .update(aiAnalyses)
      .set({
        status: 'FAILED',
        errorCode: error.code,
        errorMessage: error.message.slice(0, 500),
        completedAt: new Date(),
        model: o.model ?? null,
        inputTokens: o.inputTokens ?? 0,
        outputTokens: o.outputTokens ?? 0,
        latencyMs: o.latencyMs ?? 0,
        estimatedCost: String(o.estimatedCost ?? 0),
      })
      .where(and(eq(aiAnalyses.id, id), inArray(aiAnalyses.status, [...ACTIVE])))
      .returning();
    return row;
  },

  async countSince(ex: Executor, organizationId: string, since: Date): Promise<number> {
    const [row] = await ex
      .select({ n: sql<number>`count(*)::int` })
      .from(aiAnalyses)
      .where(
        and(
          eq(aiAnalyses.organizationId, organizationId),
          sql`${aiAnalyses.createdAt} >= ${since}`,
        ),
      );
    return row?.n ?? 0;
  },

  async usage(ex: Executor, organizationId: string, since: Date) {
    const [row] = await ex
      .select({
        analyses: sql<number>`count(*)::int`,
        completed: sql<number>`(count(*) FILTER (WHERE ${aiAnalyses.status} = 'COMPLETED'))::int`,
        failed: sql<number>`(count(*) FILTER (WHERE ${aiAnalyses.status} = 'FAILED'))::int`,
        inputTokens: sql<number>`coalesce(sum(${aiAnalyses.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${aiAnalyses.outputTokens}), 0)::int`,
        estimatedCost: sql<number>`coalesce(sum(${aiAnalyses.estimatedCost}), 0)::float8`,
        avgLatencyMs: sql<
          number | null
        >`(avg(${aiAnalyses.latencyMs}) FILTER (WHERE ${aiAnalyses.status} = 'COMPLETED'))::float8`,
      })
      .from(aiAnalyses)
      .where(
        and(
          eq(aiAnalyses.organizationId, organizationId),
          sql`${aiAnalyses.createdAt} >= ${since}`,
        ),
      );
    return row!;
  },
};
