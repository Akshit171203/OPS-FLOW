import { UnrecoverableError } from 'bullmq';
import type { AnalysisResult, AnalysisStep } from '@opsflow/shared';
import { db } from '../../db/client';
import type { AnalysisJob } from '../../events/queues';
import { processOnce } from '../../lib/idempotency';
import { logger } from '../../lib/logger';
import { buildContext } from '../ai/context/builder';
import { gatherEvidence, retrieveRunbooks } from '../ai/context/gather';
import { parseAnalysis } from '../ai/output';
import { estimateCost } from '../ai/pricing';
import { buildPrompt } from '../ai/prompt';
import { AIProviderError, type AIProvider } from '../ai/provider';
import { toAnalysisDto } from './dto';
import { emitAnalysisRealtime } from './realtime';
import { analysisRepository as repo, type AnalysisRow } from './repository';
import { recordAnalysisEvent } from './timeline';

export interface PipelineOptions {
  provider: AIProvider;
  /** 1-based attempt number of this job and the most attempts the queue allows. */
  attempt: number;
  maxAttempts: number;
}

export type PipelineOutcome = 'completed' | 'failed' | 'skipped';

const FINAL_SCOPE = 'ai-analysis-final';

/**
 * Run one AI analysis end to end: gather evidence, retrieve runbooks, build a bounded context, ask the
 * model, validate its answer (with one repair attempt), and record the result exactly once.
 *
 * Retry semantics: a transient provider error (timeout, 429, 5xx) is rethrown while attempts remain, so the
 * queue retries with backoff. A permanent error, or the last attempt, marks the analysis FAILED with a stable
 * error code and throws UnrecoverableError so the job lands in the failed set.
 */
export async function runAnalysis(
  job: AnalysisJob,
  { provider, attempt, maxAttempts }: PipelineOptions,
): Promise<PipelineOutcome> {
  const orgId = job.organizationId;
  const row = await repo.find(db, orgId, job.analysisId);
  if (!row || row.status === 'COMPLETED' || row.status === 'FAILED') return 'skipped'; // duplicate or late delivery

  const actor = {
    organizationId: orgId,
    incidentId: row.incidentId,
    analysisId: row.id,
    actorId: row.createdBy,
  };
  const started = await repo.claimStart(db, orgId, row.id);
  if (started) {
    await db.transaction((tx) => recordAnalysisEvent(tx, actor, 'ai.analysis.started'));
    await emitAnalysisRealtime(orgId, row.incidentId, 'ai.analysis_started', {
      analysisId: row.id,
      analysis: toAnalysisDto(started),
    });
  }
  const progress = (step: AnalysisStep) =>
    emitAnalysisRealtime(orgId, row.incidentId, 'ai.analysis_progress', {
      analysisId: row.id,
      step,
    });

  // Usage is accumulated across the first call and the optional repair call, and survives a failure
  const used = { inputTokens: 0, outputTokens: 0, latencyMs: 0, model: provider.model };
  try {
    await progress('collecting_context');
    const evidence = await gatherEvidence(db, orgId, row.incidentId);
    if (!evidence)
      throw new AIProviderError('AI_BAD_REQUEST', 'The incident no longer exists', false);

    await progress('searching_runbooks');
    const runbookChunks = await retrieveRunbooks(db, orgId, evidence, provider);

    const context = buildContext({ ...evidence, runbookChunks });
    const prompt = buildPrompt(context);

    await progress('generating');
    const first = await provider.analyzeIncident({ context, prompt });
    add(used, first);
    let parsed = parseAnalysis(first.text);

    if (!parsed.ok) {
      await progress('repairing');
      const second = await provider.analyzeIncident({
        context,
        prompt,
        repair: { previousOutput: first.text, problem: parsed.problem },
      });
      add(used, second);
      parsed = parseAnalysis(second.text);
      if (!parsed.ok) {
        throw new AIProviderError(
          'AI_INVALID_OUTPUT',
          `The model's answer could not be used: ${parsed.problem}`,
          false,
        );
      }
    }
    return await finishCompleted(row, actor, parsed.result, used);
  } catch (err) {
    const retryable = err instanceof AIProviderError ? err.retryable : true; // unknown errors (e.g. a database blip) are worth retrying
    if (retryable && attempt < maxAttempts) throw err; // let the queue back off and try again

    const failure =
      err instanceof AIProviderError
        ? { code: err.code, message: err.message }
        : {
            code: 'AI_UNKNOWN',
            message: 'Something unexpected went wrong while analyzing this incident.',
          };
    if (!(err instanceof AIProviderError))
      logger.error({ err, analysis_id: row.id }, 'unexpected analysis failure');
    await finishFailed(row, actor, failure, used);
    throw new UnrecoverableError(failure.message);
  }
}

function add(
  acc: { inputTokens: number; outputTokens: number; latencyMs: number; model: string },
  r: { model: string; usage: { inputTokens: number; outputTokens: number; latencyMs: number } },
) {
  acc.inputTokens += r.usage.inputTokens;
  acc.outputTokens += r.usage.outputTokens;
  acc.latencyMs += r.usage.latencyMs;
  acc.model = r.model;
}

type Actor = { organizationId: string; incidentId: string; analysisId: string; actorId: string };
type Used = { inputTokens: number; outputTokens: number; latencyMs: number; model: string };

async function finishCompleted(
  row: AnalysisRow,
  actor: Actor,
  result: AnalysisResult,
  used: Used,
): Promise<PipelineOutcome> {
  const cost = estimateCost(used.model, used.inputTokens, used.outputTokens);
  // processOnce: even if the job is delivered or retried twice, the result is recorded exactly once
  const outcome = await processOnce(row.id, FINAL_SCOPE, async (tx) => {
    const updated = await repo.complete(tx, row.id, result, { ...used, estimatedCost: cost });
    if (!updated) return null; // already finished another way (e.g. expired as stale)
    await recordAnalysisEvent(tx, actor, 'ai.analysis.completed', {
      model: used.model,
      overallConfidence: result.overallConfidence,
      inputTokens: used.inputTokens,
      outputTokens: used.outputTokens,
    });
    return updated;
  });
  if (outcome.ran && outcome.result) {
    await emitAnalysisRealtime(actor.organizationId, actor.incidentId, 'ai.analysis_completed', {
      analysisId: row.id,
      analysis: toAnalysisDto(outcome.result),
    });
    return 'completed';
  }
  return 'skipped';
}

async function finishFailed(
  row: AnalysisRow,
  actor: Actor,
  failure: { code: string; message: string },
  used: Used,
) {
  const cost = estimateCost(used.model, used.inputTokens, used.outputTokens);
  const outcome = await processOnce(row.id, FINAL_SCOPE, async (tx) => {
    const updated = await repo.fail(tx, row.id, failure, { ...used, estimatedCost: cost });
    if (!updated) return null;
    await recordAnalysisEvent(tx, actor, 'ai.analysis.failed', {
      code: failure.code,
      message: failure.message,
    });
    return updated;
  });
  if (outcome.ran && outcome.result) {
    await emitAnalysisRealtime(actor.organizationId, actor.incidentId, 'ai.analysis_failed', {
      analysisId: row.id,
      analysis: toAnalysisDto(outcome.result),
    });
  }
}
