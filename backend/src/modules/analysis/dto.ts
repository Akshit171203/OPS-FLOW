import type { AiAnalysisDto, AiErrorCode, AnalysisResult } from '@opsflow/shared';
import type { AnalysisRow } from './repository';

export const toAnalysisDto = (r: AnalysisRow): AiAnalysisDto => ({
  id: r.id,
  incidentId: r.incidentId,
  status: r.status,
  model: r.model,
  promptVersion: r.promptVersion,
  result: (r.result as AnalysisResult | null) ?? null,
  error: r.errorCode ? { code: r.errorCode as AiErrorCode, message: r.errorMessage ?? '' } : null,
  inputTokens: r.inputTokens,
  outputTokens: r.outputTokens,
  latencyMs: r.latencyMs,
  estimatedCost: r.estimatedCost === null ? null : Number(r.estimatedCost),
  startedAt: r.startedAt?.toISOString() ?? null,
  completedAt: r.completedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
  createdBy: r.createdBy,
});
