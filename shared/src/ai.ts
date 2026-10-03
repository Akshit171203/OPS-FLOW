import { z } from 'zod';
import type { AiErrorCode, AnalysisStatus, AnalysisStep, RunbookIndexStatus } from './enums';

/** The validated shape every analysis result must have, whatever model produced it. */
export const AnalysisResultSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  possibleCauses: z
    .array(
      z.object({
        cause: z.string().trim().min(1).max(500),
        confidence: z.number().min(0).max(1),
        /** Which log, deployment, metric or runbook supports this cause. */
        evidence: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
      }),
    )
    .min(1)
    .max(5),
  suggestedSteps: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
  overallConfidence: z.number().min(0).max(1),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export interface AiAnalysisDto {
  id: string;
  incidentId: string;
  status: AnalysisStatus;
  model: string | null;
  promptVersion: string;
  result: AnalysisResult | null;
  error: { code: AiErrorCode; message: string } | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  estimatedCost: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  createdBy: string;
}

export interface AiAnalysisResponse {
  latest: AiAnalysisDto | null;
  history: AiAnalysisDto[];
}

export interface StartAnalysisResponse {
  analysisId: string;
  status: AnalysisStatus;
  /** True when an analysis was already queued or running and was returned instead of starting another. */
  existing: boolean;
}

export interface AiUsageDto {
  days: number;
  analyses: number;
  completed: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  avgLatencyMs: number | null;
}

export interface RunbookDto {
  id: string;
  title: string;
  content?: string;
  serviceTag: string | null;
  indexStatus: RunbookIndexStatus;
  indexError: string | null;
  chunkCount: number;
  indexedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisRealtimeData {
  incidentId: string;
  analysisId: string;
  step?: AnalysisStep;
  analysis?: AiAnalysisDto;
}
