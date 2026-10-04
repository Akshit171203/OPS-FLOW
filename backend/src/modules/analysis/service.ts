import type { AiAnalysisResponse, AiUsageDto, StartAnalysisResponse } from '@opsflow/shared';
import { db } from '../../db/client';
import { getAnalysisQueue } from '../../events/queues';
import type { RequestContext } from '../../lib/context';
import { config } from '../../lib/config';
import { AppError, ConflictError, NotFoundError, RateLimitError } from '../../lib/errors';
import { isUniqueViolation } from '../../lib/dbErrors';
import { acquireLock, releaseLock } from '../../lib/locks';
import { logger } from '../../lib/logger';
import { PROMPT_VERSION } from '../ai/prompt';
import { incidentsRepository } from '../incidents/repository';
import { toAnalysisDto } from './dto';
import { emitAnalysisRealtime } from './realtime';
import { analysisRepository as repo, type AnalysisRow } from './repository';
import { recordAnalysisEvent } from './timeline';

/** An analysis that is still "active" after this long was lost (worker died, job dropped) and must not block new ones. */
export const STALE_AFTER_MS = 10 * 60_000;
const LOCK_TTL_MS = 10_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const asStart = (row: AnalysisRow, existing: boolean): StartAnalysisResponse => ({
  analysisId: row.id,
  status: row.status,
  existing,
});

async function expireIfStale(
  ctx: RequestContext,
  row: AnalysisRow,
): Promise<AnalysisRow | undefined> {
  if (Date.now() - row.createdAt.getTime() < STALE_AFTER_MS) return row;
  const failed = await repo.fail(db, row.id, {
    code: 'AI_TIMEOUT',
    message: 'The analysis did not finish in time and was abandoned.',
  });
  if (failed) {
    await emitAnalysisRealtime(ctx.actor.organizationId, row.incidentId, 'ai.analysis_failed', {
      analysisId: row.id,
      analysis: toAnalysisDto(failed),
    });
  }
  return undefined;
}

export const analysisService = {
  /**
   * Start an analysis, or return the one already queued or running. A short per-incident lock
   * serializes concurrent requests, and a partial unique index in the database guarantees at most one
   * active analysis per incident even if the lock were ever bypassed.
   */
  async start(ctx: RequestContext, incidentId: string): Promise<StartAnalysisResponse> {
    const orgId = ctx.actor.organizationId;
    if (!(await incidentsRepository.find(db, orgId, incidentId))) {
      throw new NotFoundError('Incident not found', 'INCIDENT_NOT_FOUND');
    }

    const lockKey = `ai-analysis:${incidentId}`;
    let token = await acquireLock(lockKey, LOCK_TTL_MS);
    // Another request is creating one right now: wait briefly for its row and share it
    for (let i = 0; !token && i < 30; i++) {
      await sleep(100);
      const active = await repo.findActive(db, orgId, incidentId);
      if (active) return asStart(active, true);
      token = await acquireLock(lockKey, LOCK_TTL_MS);
    }
    if (!token)
      throw new ConflictError('An analysis is being started by someone else', 'LOCK_HELD');

    try {
      const active = await repo.findActive(db, orgId, incidentId);
      if (active && (await expireIfStale(ctx, active))) return asStart(active, true);

      // Cost protection: a cap on how many analyses an organization may start per rolling 24 hours.
      // Checked only when a NEW analysis would start, so re-clicking a running one is never blocked by it.
      if (config.AI_DAILY_CAP > 0) {
        const started = await repo.countSince(db, orgId, new Date(Date.now() - 24 * 3_600_000));
        if (started >= config.AI_DAILY_CAP) {
          throw new RateLimitError(
            `This organization has reached its limit of ${config.AI_DAILY_CAP} AI analyses per day. It resets as older ones age out.`,
            'AI_DAILY_CAP',
          );
        }
      }

      let row: AnalysisRow;
      try {
        row = await db.transaction(async (tx) => {
          const created = await repo.insert(tx, {
            organizationId: orgId,
            incidentId,
            promptVersion: PROMPT_VERSION,
            createdBy: ctx.actor.userId,
          });
          await recordAnalysisEvent(
            tx,
            {
              organizationId: orgId,
              incidentId,
              analysisId: created.id,
              actorId: ctx.actor.userId,
            },
            'ai.analysis.requested',
          );
          return created;
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const winner = await repo.findActive(db, orgId, incidentId);
        if (!winner) throw err;
        return asStart(winner, true);
      }

      try {
        await getAnalysisQueue().add(
          'analyze-incident',
          { analysisId: row.id, organizationId: orgId, requestId: ctx.requestId },
          { jobId: row.id },
        );
      } catch (err) {
        // Never leave a QUEUED row nobody will process: it would block new analyses until it went stale
        logger.error({ err, analysis_id: row.id }, 'failed to queue analysis');
        await repo.fail(db, row.id, {
          code: 'AI_UNAVAILABLE',
          message: 'Could not queue the analysis. Try again shortly.',
        });
        throw new AppError(
          503,
          'QUEUE_UNAVAILABLE',
          'Could not queue the analysis. Try again shortly.',
        );
      }
      return asStart(row, false);
    } finally {
      await releaseLock(lockKey, token).catch(() => undefined);
    }
  },

  async get(ctx: RequestContext, incidentId: string): Promise<AiAnalysisResponse> {
    const orgId = ctx.actor.organizationId;
    if (!(await incidentsRepository.find(db, orgId, incidentId))) {
      throw new NotFoundError('Incident not found', 'INCIDENT_NOT_FOUND');
    }
    const rows = await repo.history(db, orgId, incidentId, 10);
    return { latest: rows[0] ? toAnalysisDto(rows[0]) : null, history: rows.map(toAnalysisDto) };
  },

  async usage(ctx: RequestContext, days: number): Promise<AiUsageDto> {
    const since = new Date(Date.now() - days * 86_400_000);
    const u = await repo.usage(db, ctx.actor.organizationId, since);
    return {
      days,
      analyses: u.analyses,
      completed: u.completed,
      failed: u.failed,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      estimatedCost: Math.round(u.estimatedCost * 1_000_000) / 1_000_000,
      avgLatencyMs: u.avgLatencyMs === null ? null : Math.round(u.avgLatencyMs),
    };
  },
};
