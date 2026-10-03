import type { AiErrorCode } from '@opsflow/shared';
import type { AnalysisContext } from './context/types';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface AnalysisRequest {
  /** The bounded evidence. Real providers get it through `prompt`; the fake reads it directly. */
  context: AnalysisContext;
  prompt: { system: string; user: string };
  /** Set on the single repair attempt after invalid output. */
  repair?: { previousOutput: string; problem: string };
}

export interface AnalysisResponse {
  /** Raw model text. It is validated by the caller, never trusted. */
  text: string;
  model: string;
  usage: Usage;
}

export interface EmbeddingResponse {
  vector: number[];
  model: string;
  usage: Usage;
}

export interface AIProvider {
  readonly name: string;
  /** Model identifiers, stored with results and embeddings so they can be told apart later. */
  readonly model: string;
  readonly embeddingModel: string;
  analyzeIncident(request: AnalysisRequest): Promise<AnalysisResponse>;
  generateEmbedding(text: string, task?: 'document' | 'query'): Promise<EmbeddingResponse>;
}

/**
 * A provider failure with a stable code. `retryable` decides whether the job queue should try again
 * (timeouts, rate limits, server errors) or fail the analysis immediately (bad key, bad request, empty reply).
 */
export class AIProviderError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

/** Map an HTTP status from a provider to our error codes. */
export function errorFromStatus(status: number, detail: string): AIProviderError {
  if (status === 429)
    return new AIProviderError('AI_RATE_LIMITED', `Provider rate limit reached. ${detail}`, true);
  if (status === 408 || status === 504)
    return new AIProviderError('AI_TIMEOUT', `Provider timed out. ${detail}`, true);
  if (status >= 500)
    return new AIProviderError(
      'AI_UNAVAILABLE',
      `Provider unavailable (${status}). ${detail}`,
      true,
    );
  if (status === 401 || status === 403)
    return new AIProviderError('AI_AUTH_FAILED', `Provider rejected the API key. ${detail}`, false);
  if (status >= 400)
    return new AIProviderError(
      'AI_BAD_REQUEST',
      `Provider rejected the request (${status}). ${detail}`,
      false,
    );
  return new AIProviderError(
    'AI_UNKNOWN',
    `Unexpected provider response (${status}). ${detail}`,
    false,
  );
}

/** Used when AI_PROVIDER=gemini but no key is set: every call fails cleanly, nothing else is affected. */
export class UnconfiguredProvider implements AIProvider {
  readonly name = 'unconfigured';
  readonly model = 'none';
  readonly embeddingModel = 'none';
  constructor(private readonly reason: string) {}
  private fail(): never {
    throw new AIProviderError('AI_NOT_CONFIGURED', this.reason, false);
  }
  analyzeIncident(): Promise<AnalysisResponse> {
    return Promise.resolve().then(() => this.fail());
  }
  generateEmbedding(): Promise<EmbeddingResponse> {
    return Promise.resolve().then(() => this.fail());
  }
}
