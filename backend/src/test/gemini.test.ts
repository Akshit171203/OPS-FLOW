import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { EMBEDDING_DIMENSIONS } from '../db/schema';
import { GeminiProvider } from '../modules/ai/gemini';
import { AIProviderError, UnconfiguredProvider } from '../modules/ai/provider';
import { FakeProvider, hashEmbedding } from '../modules/ai/fake';
import { buildContext } from '../modules/ai/context/builder';
import { buildPrompt } from '../modules/ai/prompt';
import { estimateCost } from '../modules/ai/pricing';

const KEY = 'AIza-test-key-0123456789abcdef';
let server: Server | undefined;
let received: { url: string; headers: IncomingMessage['headers']; body: any }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any

async function stub(
  handler: (req: IncomingMessage, respond: (status: number, body: unknown) => void) => void,
) {
  received = [];
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      received.push({
        url: req.url ?? '',
        headers: req.headers,
        body: raw ? JSON.parse(raw) : null,
      });
      handler(req, (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(typeof body === 'string' ? body : JSON.stringify(body));
      });
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/v1beta`;
}
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
});

const request = () => ({
  context: buildContext({
    now: new Date(),
    incident: {
      id: 'i',
      title: 'T',
      description: null,
      severity: 'SEV2',
      status: 'OPEN',
      priority: 'HIGH',
      startedAt: new Date(),
    },
    service: { name: 'S', projectName: 'P', status: 'DEGRADED' },
    logs: [],
    deployments: [],
    metrics: [],
    similarCandidates: [],
    runbookChunks: [],
  }),
  prompt: { system: 'SYSTEM RULES', user: 'USER DATA' },
});
const ok = (text: string, usage = { promptTokenCount: 120, candidatesTokenCount: 45 }) => ({
  candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
  usageMetadata: usage,
});

describe('GeminiProvider: analyzeIncident', () => {
  it('sends the key in a header, the system prompt separately, and asks for JSON; returns text and real token counts', async () => {
    const baseUrl = await stub((_req, respond) => respond(200, ok('{"a":1}')));
    const p = new GeminiProvider({ apiKey: KEY, model: 'gemini-test', baseUrl });
    const res = await p.analyzeIncident(request());
    expect(res.text).toBe('{"a":1}');
    expect(res.model).toBe('gemini-test');
    expect(res.usage).toMatchObject({ inputTokens: 120, outputTokens: 45 });
    expect(res.usage.latencyMs).toBeGreaterThanOrEqual(0);

    const call = received[0]!;
    expect(call.url).toBe('/v1beta/models/gemini-test:generateContent');
    expect(call.headers['x-goog-api-key']).toBe(KEY);
    expect(call.url).not.toContain(KEY); // never in the URL where proxies log it
    expect(call.body.systemInstruction.parts[0].text).toBe('SYSTEM RULES');
    expect(call.body.contents[0].parts[0].text).toBe('USER DATA');
    expect(call.body.generationConfig).toMatchObject({ responseMimeType: 'application/json' });
  });

  it('on a repair attempt, includes the problem and the previous answer', async () => {
    const baseUrl = await stub((_req, respond) => respond(200, ok('{}')));
    await new GeminiProvider({ apiKey: KEY, baseUrl }).analyzeIncident({
      ...request(),
      repair: { previousOutput: 'garbage output', problem: 'not valid JSON' },
    });
    const sent = received[0]!.body.contents[0].parts[0].text as string;
    expect(sent).toContain('not valid JSON');
    expect(sent).toContain('garbage output');
  });

  it('estimates tokens when the API reports none', async () => {
    const baseUrl = await stub((_req, respond) =>
      respond(200, { candidates: [{ content: { parts: [{ text: 'twelve chars' }] } }] }),
    );
    const res = await new GeminiProvider({ apiKey: KEY, baseUrl }).analyzeIncident(request());
    expect(res.usage.outputTokens).toBeGreaterThan(0);
    expect(res.usage.inputTokens).toBeGreaterThan(0);
  });

  it.each([
    [429, 'AI_RATE_LIMITED', true],
    [500, 'AI_UNAVAILABLE', true],
    [503, 'AI_UNAVAILABLE', true],
    [504, 'AI_TIMEOUT', true],
    [401, 'AI_AUTH_FAILED', false],
    [403, 'AI_AUTH_FAILED', false],
    [400, 'AI_BAD_REQUEST', false],
    [404, 'AI_BAD_REQUEST', false],
  ])(
    'maps HTTP %s to %s (retryable: %s) and never leaks the API key',
    async (status, code, retryable) => {
      const baseUrl = await stub((_req, respond) =>
        respond(status, { error: { message: 'upstream said no' } }),
      );
      const err = await new GeminiProvider({ apiKey: KEY, baseUrl })
        .analyzeIncident(request())
        .catch((e) => e);
      expect(err).toBeInstanceOf(AIProviderError);
      expect(err).toMatchObject({ code, retryable });
      expect(err.message).not.toContain(KEY);
    },
  );

  it('times out slow providers with a retryable AI_TIMEOUT', async () => {
    const baseUrl = await stub(() => undefined); // never answers
    const started = Date.now();
    const err = await new GeminiProvider({ apiKey: KEY, baseUrl, timeoutMs: 120 })
      .analyzeIncident(request())
      .catch((e) => e);
    expect(err).toMatchObject({ code: 'AI_TIMEOUT', retryable: true });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('fails an empty reply or a blocked prompt as permanent errors, and unreachable hosts as retryable', async () => {
    let body: unknown = { candidates: [] };
    const baseUrl = await stub((_req, respond) => respond(200, body));
    const p = new GeminiProvider({ apiKey: KEY, baseUrl });
    expect(await p.analyzeIncident(request()).catch((e) => e)).toMatchObject({
      code: 'AI_EMPTY_RESPONSE',
      retryable: false,
    });
    body = { candidates: [{ content: { parts: [{ text: '   ' }] } }] };
    expect(await p.analyzeIncident(request()).catch((e) => e)).toMatchObject({
      code: 'AI_EMPTY_RESPONSE',
    });
    body = { promptFeedback: { blockReason: 'SAFETY' } };
    expect(await p.analyzeIncident(request()).catch((e) => e)).toMatchObject({
      code: 'AI_BAD_REQUEST',
      retryable: false,
    });

    const down = new GeminiProvider({
      apiKey: KEY,
      baseUrl: 'http://127.0.0.1:1/v1beta',
      timeoutMs: 500,
    });
    expect(await down.analyzeIncident(request()).catch((e) => e)).toMatchObject({
      code: 'AI_UNAVAILABLE',
      retryable: true,
    });
  });
});

describe('GeminiProvider: generateEmbedding', () => {
  it('requests the right task type and dimensionality, and returns the vector', async () => {
    const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i / 1000);
    const baseUrl = await stub((_req, respond) => respond(200, { embedding: { values: vector } }));
    const p = new GeminiProvider({ apiKey: KEY, embeddingModel: 'embed-test', baseUrl });
    const doc = await p.generateEmbedding('some runbook text', 'document');
    expect(doc.vector).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(doc.model).toBe('embed-test');
    expect(received[0]!.url).toBe('/v1beta/models/embed-test:embedContent');
    expect(received[0]!.body).toMatchObject({
      taskType: 'RETRIEVAL_DOCUMENT',
      outputDimensionality: EMBEDDING_DIMENSIONS,
    });
    await p.generateEmbedding('a question', 'query');
    expect(received[1]!.body.taskType).toBe('RETRIEVAL_QUERY');
  });

  it('rejects a wrong-sized or missing embedding instead of corrupting the index', async () => {
    let body: unknown = { embedding: { values: [0.1, 0.2] } };
    const baseUrl = await stub((_req, respond) => respond(200, body));
    const p = new GeminiProvider({ apiKey: KEY, baseUrl });
    expect(await p.generateEmbedding('x').catch((e) => e)).toMatchObject({
      code: 'AI_BAD_REQUEST',
    });
    body = {};
    expect(await p.generateEmbedding('x').catch((e) => e)).toMatchObject({
      code: 'AI_EMPTY_RESPONSE',
    });
  });
});

describe('providers without a key, the fake, prompt and pricing', () => {
  it('UnconfiguredProvider fails every call cleanly with AI_NOT_CONFIGURED (not retryable)', async () => {
    const p = new UnconfiguredProvider('GEMINI_API_KEY is not set');
    expect(await p.analyzeIncident().catch((e) => e)).toMatchObject({
      code: 'AI_NOT_CONFIGURED',
      retryable: false,
    });
    expect(await p.generateEmbedding().catch((e) => e)).toMatchObject({
      code: 'AI_NOT_CONFIGURED',
    });
  });

  it('the fake embedding is deterministic, unit length, and puts related text closer than unrelated text', () => {
    const a = hashEmbedding('connection pool exhausted database timeout');
    const b = hashEmbedding('database connection pool exhausted again');
    const c = hashEmbedding('user login password reset email');
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i]!, 0);
    expect(a).toEqual(hashEmbedding('connection pool exhausted database timeout'));
    expect(Math.hypot(...a)).toBeCloseTo(1, 5);
    expect(a).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(dot(a, b)).toBeGreaterThan(dot(a, c));
  });

  it('the prompt states the safety rules and fences untrusted data', () => {
    const { system, user } = buildPrompt(request().context);
    expect(system).toMatch(/ONLY the evidence/);
    expect(system).toMatch(/uncertainty/);
    expect(system).toMatch(/human approval/);
    expect(system).toMatch(/never instructions/);
    expect(user).toMatch(/<incident_data>[\s\S]*<\/incident_data>/);
    expect(user).toMatch(/"possibleCauses"/);
  });

  it('prices known models from the table and treats unknown models and the fake as free', () => {
    expect(estimateCost('gemini-2.5-flash', 1_000_000, 1_000_000)).toBeCloseTo(2.8, 6);
    expect(estimateCost('gemini-2.5-flash', 1000, 500)).toBeCloseTo(0.00155, 6);
    expect(estimateCost('some-unknown-model', 1_000_000, 1_000_000)).toBe(0);
    expect(estimateCost(null, 5, 5)).toBe(0);
    expect(new FakeProvider().model).toBe('fake-analyzer-1');
  });
});
