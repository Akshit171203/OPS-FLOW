import type { AnalysisResult } from '@opsflow/shared';
import { EMBEDDING_DIMENSIONS } from '../../db/schema';
import type { AIProvider, AnalysisRequest, AnalysisResponse, EmbeddingResponse } from './provider';
import type { AnalysisContext } from './context/types';

const STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'are',
  'was',
  'not',
  'has',
  'have',
  'you',
  'your',
  'can',
  'will',
  'into',
  'then',
  'when',
  'than',
  'been',
]);

/** 32-bit FNV-1a. */
function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Deterministic offline embedding by feature hashing: each word (and each adjacent word pair) adds
 * weight to one of 768 buckets, then the vector is length-normalized. Texts sharing words end up
 * close under cosine distance, so retrieval behaves sensibly in tests and local development
 * without any API key. It is NOT a semantic model: it matches words, not meaning.
 */
export function hashEmbedding(text: string): number[] {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  words.forEach((w, i) => {
    v[fnv(w) % EMBEDDING_DIMENSIONS]! += 1;
    if (i > 0) v[fnv(`${words[i - 1]} ${w}`) % EMBEDDING_DIMENSIONS]! += 0.7;
  });
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

const approxTokens = (s: string) => Math.ceil(s.length / 4);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** A plausible, evidence-citing analysis built from the context, so the whole flow works offline. */
export function heuristicAnalysis(c: AnalysisContext): AnalysisResult {
  const causes: AnalysisResult['possibleCauses'] = [];
  const poolPattern = c.errorPatterns.find(
    (p) => /pool|connection/.test(p.signature) && /exhaust|timeout|acquir/.test(p.signature),
  );
  const suspectDeploy = c.deployments.find(
    (d) => d.minutesBeforeIncident >= -5 && d.minutesBeforeIncident <= 90,
  );
  const m = c.metrics.latest;
  // cite the retrieved excerpt that actually supports the cause, not merely the top-ranked one
  const runbook = c.runbookExcerpts.find((r) => /pool/i.test(r.excerpt)) ?? c.runbookExcerpts[0];

  if (poolPattern) {
    const evidence = [
      `log: "${poolPattern.sample}" (${poolPattern.count} occurrences between ${poolPattern.firstSeen} and ${poolPattern.lastSeen})`,
    ];
    if (m && (m.errorRate > 0.05 || m.latencyMs > 1000)) {
      evidence.push(
        `metrics: error rate ${pct(m.errorRate)} and latency ${m.latencyMs} ms at ${m.capturedAt}`,
      );
    }
    if (runbook && /pool/i.test(runbook.excerpt)) {
      evidence.push(`runbook: "${runbook.runbook}" describes pool exhaustion and its remediation`);
    }
    causes.push({
      cause: `Database connection pool exhaustion in ${c.service.name}`,
      confidence: 0.82,
      evidence,
    });
  }
  if (suspectDeploy) {
    const evidence = [
      `deployment: ${suspectDeploy.version} (${suspectDeploy.commitSha}) went to ${suspectDeploy.environment} ${Math.abs(suspectDeploy.minutesBeforeIncident)} minutes before the incident started`,
    ];
    if (poolPattern)
      evidence.push(`log: the "${poolPattern.sample}" errors begin after that deployment`);
    causes.push({
      cause: `Regression introduced by deployment ${suspectDeploy.version}`,
      confidence: poolPattern ? 0.74 : 0.5,
      evidence,
    });
  }
  if (causes.length === 0) {
    causes.push({
      cause: 'The cause cannot be determined from the available evidence',
      confidence: 0.2,
      evidence: [
        `logs: ${c.errorLogs.length} error lines, no dominant pattern`,
        `metrics: ${m ? `error rate ${pct(m.errorRate)}` : 'no recent snapshot'}`,
      ],
    });
  }
  causes.sort((a, b) => b.confidence - a.confidence);

  const steps: string[] = [];
  if (suspectDeploy) {
    steps.push(
      `Review what ${suspectDeploy.version} changed, especially connection pool and timeout settings`,
    );
    steps.push(
      `Roll back ${suspectDeploy.version} to the previous version (requires human approval before it is executed)`,
    );
  }
  if (poolPattern) {
    steps.push(
      'Inspect active database connections and long-running queries (for example pg_stat_activity)',
    );
    steps.push(
      'Confirm the pool maximum against the database connection limit before raising it (requires human approval)',
    );
  }
  steps.push('Add or confirm alerting on connection pool saturation and error rate');
  if (steps.length === 1)
    steps.unshift('Gather more logs and metrics for this service before acting');

  const lead = poolPattern
    ? `${c.service.name} is failing with ${poolPattern.count} errors like "${poolPattern.sample}"`
    : `${c.service.name} is unhealthy but no dominant error pattern was found`;
  const tail = suspectDeploy ? `, beginning shortly after deployment ${suspectDeploy.version}` : '';
  return {
    summary: `${lead}${tail}. ${causes[0]!.cause} is the most likely cause; confidence is ${pct(causes[0]!.confidence)}.`,
    possibleCauses: causes.slice(0, 5),
    suggestedSteps: steps.slice(0, 8),
    overallConfidence: Math.max(0.1, causes[0]!.confidence - 0.05),
  };
}

export interface FakeProviderOptions {
  /**
   * Replace the analysis step in tests. Return the raw model text, or throw an AIProviderError to
   * simulate a failure. `call` counts invocations, starting at 1.
   */
  analyze?: (request: AnalysisRequest, call: number) => string | Promise<string>;
  embed?: (text: string, call: number) => number[] | Promise<number[]>;
}

export class FakeProvider implements AIProvider {
  readonly name = 'fake';
  readonly model: string = 'fake-analyzer-1';
  readonly embeddingModel = 'fake-hash-768';
  analyzeCalls = 0;
  embedCalls = 0;
  constructor(private readonly options: FakeProviderOptions = {}) {}

  async analyzeIncident(request: AnalysisRequest): Promise<AnalysisResponse> {
    const started = Date.now();
    this.analyzeCalls += 1;
    const text = this.options.analyze
      ? await this.options.analyze(request, this.analyzeCalls)
      : JSON.stringify(heuristicAnalysis(request.context));
    return {
      text,
      model: this.model,
      usage: {
        inputTokens: approxTokens(request.prompt.system + request.prompt.user),
        outputTokens: approxTokens(text),
        latencyMs: Date.now() - started,
      },
    };
  }

  async generateEmbedding(
    text: string,
    _task: 'document' | 'query' = 'document',
  ): Promise<EmbeddingResponse> {
    this.embedCalls += 1;
    const vector = this.options.embed
      ? await this.options.embed(text, this.embedCalls)
      : hashEmbedding(text);
    return {
      vector,
      model: this.embeddingModel,
      usage: { inputTokens: approxTokens(text), outputTokens: 0, latencyMs: 0 },
    };
  }
}
