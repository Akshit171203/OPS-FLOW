import { describe, expect, it } from 'vitest';
import {
  buildContext,
  enforceBudget,
  errorSignature,
  titleSimilarity,
} from '../modules/ai/context/builder';
import { clean, redact } from '../modules/ai/context/redact';
import { DEFAULT_CAPS, type RawContextInput } from '../modules/ai/context/types';

const NOW = new Date('2026-05-01T12:00:00Z');
const T0 = new Date('2026-05-01T11:50:00Z');

function raw(over: Partial<RawContextInput> = {}): RawContextInput {
  return {
    now: NOW,
    incident: {
      id: 'i1',
      title: 'Payment failures after rollout',
      description: 'Checkout is failing',
      severity: 'SEV1',
      status: 'OPEN',
      priority: 'URGENT',
      startedAt: T0,
    },
    service: { name: 'Payment Service', projectName: 'Platform', status: 'DEGRADED' },
    logs: [],
    deployments: [],
    metrics: [],
    similarCandidates: [],
    runbookChunks: [],
    ...over,
  };
}
const log = (i: number, message = `Connection pool exhausted: active=50 max=50 waiting=${i}`) => ({
  timestamp: new Date(T0.getTime() + i * 1000),
  level: 'ERROR',
  message,
});

describe('caps', () => {
  it('limits error logs to the newest 50, each cut to 300 characters', () => {
    const logs = Array.from({ length: 400 }, (_, i) => log(i, `${'x'.repeat(900)} #${i}`));
    const c = buildContext(raw({ logs }));
    expect(c.errorLogs).toHaveLength(50);
    expect(c.errorLogs.every((l) => l.message.length <= DEFAULT_CAPS.maxLogChars)).toBe(true);
    expect(c.errorLogs[0]!.timestamp > c.errorLogs[49]!.timestamp).toBe(true); // newest first
    expect(c.truncation).toContain('logs: showing 50 of 400');
  });

  it('limits deployments, metrics, similar incidents and runbook chunks', () => {
    const deployments = Array.from({ length: 30 }, (_, i) => ({
      version: `v${i}`,
      commitSha: 'abc',
      environment: 'production',
      status: 'SUCCESS',
      deployedAt: new Date(T0.getTime() - i * 60_000),
      linked: false,
    }));
    const metrics = Array.from({ length: 40 }, (_, i) => ({
      capturedAt: new Date(T0.getTime() - i * 60_000),
      errorRate: 0.1,
      latencyMs: 100,
      requestsPerMin: 10,
      healthStatus: 'DEGRADED' as const,
    }));
    const similarCandidates = Array.from({ length: 20 }, (_, i) => ({
      title: `Payment failures after rollout ${i}`,
      severity: 'SEV2' as const,
      status: 'RESOLVED' as const,
      startedAt: T0,
      resolvedAt: new Date(T0.getTime() + 30 * 60_000),
    }));
    const runbookChunks = Array.from({ length: 9 }, (_, i) => ({
      runbookTitle: `RB ${i}`,
      content: 'z'.repeat(5000),
      score: i / 10,
    }));
    const c = buildContext(raw({ deployments, metrics, similarCandidates, runbookChunks }));
    expect(c.deployments).toHaveLength(10);
    expect(c.metrics.recent).toHaveLength(6);
    expect(c.similarIncidents).toHaveLength(3);
    expect(c.runbookExcerpts).toHaveLength(3);
    expect(c.runbookExcerpts[0]!.relevance).toBeGreaterThan(c.runbookExcerpts[2]!.relevance); // best first
    expect(c.runbookExcerpts.every((r) => r.excerpt.length <= DEFAULT_CAPS.maxRunbookChars)).toBe(
      true,
    );
    expect(c.similarIncidents[0]!.resolutionMinutes).toBe(30);
  });

  it('keeps the whole serialized context under the total size ceiling, however large the input', () => {
    const logs = Array.from({ length: 400 }, (_, i) => log(i, `${'y'.repeat(900)} ${i}`));
    const runbookChunks = Array.from({ length: 9 }, () => ({
      runbookTitle: 'Big',
      content: 'w'.repeat(9000),
      score: 0.9,
    }));
    const description = 'd'.repeat(50_000);
    for (const maxTotalChars of [24_000, 8_000, 3_000]) {
      const c = buildContext(
        raw({ logs, runbookChunks, incident: { ...raw().incident, description } }),
        { ...DEFAULT_CAPS, maxTotalChars },
      );
      expect(JSON.stringify(c).length).toBeLessThanOrEqual(maxTotalChars);
      expect(c.truncation?.length).toBeGreaterThan(0); // and it says so
    }
  });

  it('is a no-op when already within budget', () => {
    const c = buildContext(raw({ logs: [log(1)] }));
    expect(enforceBudget(c, 1_000_000)).toBe(c);
  });
});

describe('error patterns and similarity', () => {
  it('groups repeated errors by signature using the real volume, not only the shown lines', () => {
    const logs = [
      ...Array.from({ length: 120 }, (_, i) => log(i)),
      ...Array.from({ length: 5 }, (_, i) =>
        log(200 + i, `Payment authorization failed for order ord_${48200 + i}: upstream timeout`),
      ),
    ];
    const c = buildContext(raw({ logs }));
    expect(c.errorPatterns[0]).toMatchObject({ count: 120 });
    expect(c.errorPatterns[0]!.signature).toBe(
      'connection pool exhausted: active=n max=n waiting=n',
    );
    expect(c.errorPatterns[1]!.count).toBe(5);
    expect(errorSignature('Timeout after 30000ms for ord_4a2b9c1d')).toBe(
      errorSignature('Timeout after 12ms for ord_9f8e7d6c'),
    );
  });

  it('finds similar past incidents by title and ignores unrelated ones', () => {
    const candidate = (title: string) => ({
      title,
      severity: 'SEV2' as const,
      status: 'RESOLVED' as const,
      startedAt: T0,
      resolvedAt: T0,
    });
    const c = buildContext(
      raw({
        similarCandidates: [
          candidate('Payment failures after rollout last week'),
          candidate('Email digest sent twice'),
          candidate('Payment failures after database migration'),
        ],
      }),
    );
    expect(c.similarIncidents.map((s) => s.title)).toEqual([
      'Payment failures after rollout last week',
      'Payment failures after database migration',
    ]);
    expect(titleSimilarity('a b', 'c d')).toBe(0);
    expect(titleSimilarity('Payment failures', 'payment FAILURES')).toBe(1);
  });
});

describe('redaction: nothing secret or personal reaches the model', () => {
  it.each([
    ['user jane.doe@example.com logged in', 'jane.doe@example.com'],
    ['Authorization: Bearer abcdef1234567890abcdef', 'abcdef1234567890abcdef'],
    ['password=hunter2supersecret failed', 'hunter2supersecret'],
    ['api_key: sk-abcdefghijklmnop1234', 'sk-abcdefghijklmnop1234'],
    ['key AIzaSyA1234567890abcdefghijklmnopqrstuv used', 'AIzaSyA1234567890abcdefghijklmnopqrstuv'],
    [
      'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmno here',
      'eyJhbGciOiJIUzI1NiJ9',
    ],
    ['connect postgres://opsflow:s3cret@db.internal:5432/opsflow failed', 's3cret'],
    ['token=abc123def456 expired', 'abc123def456'],
  ])('removes the secret from "%s"', (text, secret) => {
    expect(redact(text)).not.toContain(secret);
  });

  it('keeps ordinary text intact, and redacts BEFORE truncating so a secret cut in half cannot survive', () => {
    expect(redact('Connection pool exhausted: active=50')).toBe(
      'Connection pool exhausted: active=50',
    );
    const out = clean(`${'a'.repeat(280)} password=supersecretvalue1234`, 300);
    expect(out).not.toContain('supersecret');
  });

  it('applies to every free-text field of the built context', () => {
    const secret = 'hunter2supersecret';
    const c = buildContext(
      raw({
        incident: {
          ...raw().incident,
          title: 'login for a@b.com broke',
          description: `password=${secret}`,
        },
        logs: [log(1, `token=${secret} user bob@corp.io`)],
        runbookChunks: [{ runbookTitle: 'RB', content: `api_key=${secret}`, score: 0.5 }],
        deployments: [
          {
            version: 'v1',
            commitSha: 'abc',
            environment: 'prod',
            status: 'SUCCESS',
            deployedAt: T0,
            linked: false,
          },
        ],
      }),
    );
    const text = JSON.stringify(c);
    expect(text).not.toContain(secret);
    expect(text).not.toMatch(/[a-z]+@[a-z]+\.[a-z]+/i);
  });

  it('never includes user identifiers: the context has no assignee, creator or email fields', () => {
    const text = JSON.stringify(buildContext(raw({ logs: [log(1)] })));
    for (const key of ['assignee', 'createdBy', 'email', 'userId', 'organizationId'])
      expect(text).not.toContain(key);
  });
});
