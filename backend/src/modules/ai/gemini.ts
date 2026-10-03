import { config } from '../../lib/config';
import { EMBEDDING_DIMENSIONS } from '../../db/schema';
import {
  AIProviderError,
  errorFromStatus,
  type AIProvider,
  type AnalysisRequest,
  type AnalysisResponse,
  type EmbeddingResponse,
} from './provider';

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  embeddingModel?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface GenerateResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/** Roughly four characters per token, used only where the API reports no counts. */
const approxTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * Google Gemini over its REST API (no SDK dependency). The API key is sent in a header, only from
 * the server's environment, and never returned to the browser. Every call has a timeout.
 */
export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  readonly model: string;
  readonly embeddingModel: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GeminiOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? config.GEMINI_MODEL;
    this.embeddingModel = options.embeddingModel ?? config.GEMINI_EMBEDDING_MODEL;
    this.baseUrl = (options.baseUrl ?? config.GEMINI_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? config.AI_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        throw errorFromStatus(res.status, detail);
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof AIProviderError) throw err;
      if ((err as Error).name === 'AbortError') {
        throw new AIProviderError(
          'AI_TIMEOUT',
          `Provider did not answer within ${this.timeoutMs}ms`,
          true,
        );
      }
      throw new AIProviderError(
        'AI_UNAVAILABLE',
        `Could not reach the provider: ${(err as Error).message}`,
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async analyzeIncident(request: AnalysisRequest): Promise<AnalysisResponse> {
    const started = Date.now();
    const userText = request.repair
      ? `${request.prompt.user}\n\nYour previous answer was rejected: ${request.repair.problem}\nPrevious answer:\n${request.repair.previousOutput.slice(0, 4000)}\n\nReply again with ONLY valid JSON matching the required shape.`
      : request.prompt.user;
    const data = await this.post<GenerateResponse>(`models/${this.model}:generateContent`, {
      systemInstruction: { parts: [{ text: request.prompt.system }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
        maxOutputTokens: 2048,
      },
    });
    if (data.promptFeedback?.blockReason) {
      throw new AIProviderError(
        'AI_BAD_REQUEST',
        `Provider blocked the prompt (${data.promptFeedback.blockReason})`,
        false,
      );
    }
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
      .trim();
    if (!text)
      throw new AIProviderError('AI_EMPTY_RESPONSE', 'Provider returned an empty response', false);
    return {
      text,
      model: this.model,
      usage: {
        inputTokens:
          data.usageMetadata?.promptTokenCount ?? approxTokens(request.prompt.system + userText),
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? approxTokens(text),
        latencyMs: Date.now() - started,
      },
    };
  }

  async generateEmbedding(
    text: string,
    task: 'document' | 'query' = 'document',
  ): Promise<EmbeddingResponse> {
    const started = Date.now();
    const data = await this.post<{ embedding?: { values?: number[] } }>(
      `models/${this.embeddingModel}:embedContent`,
      {
        model: `models/${this.embeddingModel}`,
        content: { parts: [{ text }] },
        taskType: task === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
        outputDimensionality: EMBEDDING_DIMENSIONS,
      },
    );
    const vector = data.embedding?.values;
    if (!vector || vector.length === 0) {
      throw new AIProviderError('AI_EMPTY_RESPONSE', 'Provider returned no embedding', false);
    }
    if (vector.length !== EMBEDDING_DIMENSIONS) {
      throw new AIProviderError(
        'AI_BAD_REQUEST',
        `Embedding has ${vector.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
        false,
      );
    }
    return {
      vector,
      model: this.embeddingModel,
      usage: { inputTokens: approxTokens(text), outputTokens: 0, latencyMs: Date.now() - started },
    };
  }
}
