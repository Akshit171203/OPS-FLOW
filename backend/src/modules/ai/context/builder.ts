import { clean } from './redact';
import {
  DEFAULT_CAPS,
  type AnalysisContext,
  type ContextCaps,
  type MetricPoint,
  type RawContextInput,
} from './types';

const MINUTE = 60_000;
const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'after',
  'from',
  'that',
  'this',
  'are',
  'was',
  'not',
  'has',
  'have',
]);

/** Collapse the variable parts of a message so repeats of the same error group together. */
export function errorSignature(message: string): string {
  return (
    message
      .toLowerCase()
      // ids mixing hex letters and digits (ord_4a2b9c1d, request hashes) collapse to one token
      .replace(/(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{6,}/g, 'x')
      .replace(/\d+(\.\d+)?/g, 'n')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 90)
  );
}

const tokens = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t)),
  );

/** Jaccard overlap of the meaningful words in two titles, 0 to 1. */
export function titleSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

const SIMILARITY_THRESHOLD = 0.2;

/**
 * Turn unbounded database rows into one bounded, redacted object. Pure: no I/O, no clock (the
 * caller passes `now`), so the caps and the redaction are directly unit-testable. Data from other
 * organizations cannot appear because the caller only ever reads one organization's rows.
 */
export function buildContext(
  raw: RawContextInput,
  caps: ContextCaps = DEFAULT_CAPS,
): AnalysisContext {
  const truncation: string[] = [];
  const startedMs = raw.incident.startedAt.getTime();

  // Newest error/warn logs first, capped, redacted, and cut to a safe length
  const sortedLogs = [...raw.logs].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  const errorLogs = sortedLogs.slice(0, caps.maxLogs).map((l) => ({
    timestamp: l.timestamp.toISOString(),
    level: l.level,
    message: clean(l.message, caps.maxLogChars),
  }));
  if (sortedLogs.length > caps.maxLogs)
    truncation.push(`logs: showing ${caps.maxLogs} of ${sortedLogs.length}`);

  // Group ALL fetched logs (not only the shown ones) by signature, so counts reflect the real volume
  const groups = new Map<string, { count: number; sample: string; first: Date; last: Date }>();
  for (const l of raw.logs) {
    const sig = errorSignature(l.message);
    const g = groups.get(sig);
    if (!g) groups.set(sig, { count: 1, sample: l.message, first: l.timestamp, last: l.timestamp });
    else {
      g.count += 1;
      if (l.timestamp < g.first) g.first = l.timestamp;
      if (l.timestamp > g.last) g.last = l.timestamp;
    }
  }
  const errorPatterns = [...groups.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, caps.maxPatterns)
    .map(([signature, g]) => ({
      signature: clean(signature, 120),
      count: g.count,
      sample: clean(g.sample, caps.maxLogChars),
      firstSeen: g.first.toISOString(),
      lastSeen: g.last.toISOString(),
    }));

  const deployments = [...raw.deployments]
    .sort((a, b) => b.deployedAt.getTime() - a.deployedAt.getTime())
    .slice(0, caps.maxDeployments)
    .map((d) => ({
      version: clean(d.version, 60),
      commitSha: clean(d.commitSha, 40),
      environment: clean(d.environment, 40),
      status: d.status,
      deployedAt: d.deployedAt.toISOString(),
      minutesBeforeIncident: Math.round((startedMs - d.deployedAt.getTime()) / MINUTE),
      linkedToIncident: d.linked,
    }));
  if (raw.deployments.length > caps.maxDeployments) {
    truncation.push(`deployments: showing ${caps.maxDeployments} of ${raw.deployments.length}`);
  }

  const points: MetricPoint[] = [...raw.metrics]
    .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
    .slice(0, caps.maxMetrics)
    .map((m) => ({
      capturedAt: m.capturedAt.toISOString(),
      errorRate: m.errorRate,
      latencyMs: m.latencyMs,
      requestsPerMin: m.requestsPerMin,
      health: m.healthStatus,
    }));

  const similarIncidents = raw.similarCandidates
    .map((c) => ({ c, score: titleSimilarity(raw.incident.title, c.title) }))
    .filter((x) => x.score >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, caps.maxSimilar)
    .map(({ c, score }) => ({
      title: clean(c.title, 200),
      severity: c.severity,
      status: c.status,
      resolutionMinutes: c.resolvedAt
        ? Math.round((c.resolvedAt.getTime() - c.startedAt.getTime()) / MINUTE)
        : null,
      similarity: Math.round(score * 100) / 100,
    }));

  const runbookExcerpts = [...raw.runbookChunks]
    .sort((a, b) => b.score - a.score)
    .slice(0, caps.maxRunbookChunks)
    .map((r) => ({
      runbook: clean(r.runbookTitle, 120),
      excerpt: clean(r.content, caps.maxRunbookChars),
      relevance: Math.round(r.score * 100) / 100,
    }));

  const context: AnalysisContext = {
    incident: {
      id: raw.incident.id,
      title: clean(raw.incident.title, 200),
      description: raw.incident.description
        ? clean(raw.incident.description, caps.maxDescriptionChars)
        : null,
      severity: raw.incident.severity,
      status: raw.incident.status,
      priority: raw.incident.priority,
      startedAt: raw.incident.startedAt.toISOString(),
      minutesOpen: Math.max(0, Math.round((raw.now.getTime() - startedMs) / MINUTE)),
    },
    service: {
      name: clean(raw.service.name, 100),
      project: clean(raw.service.projectName, 100),
      status: raw.service.status,
    },
    errorPatterns,
    errorLogs,
    deployments,
    metrics: { latest: points[0] ?? null, recent: points },
    similarIncidents,
    runbookExcerpts,
  };
  if (truncation.length) context.truncation = truncation;
  return enforceBudget(context, caps.maxTotalChars);
}

const size = (c: AnalysisContext) => JSON.stringify(c).length;

/**
 * Last line of defence: if the whole object is still too big, shed the least valuable data first
 * (older log lines, then long runbook text, similar incidents, metric history, old deployments)
 * until it fits, and say so in `truncation`.
 */
export function enforceBudget(context: AnalysisContext, maxChars: number): AnalysisContext {
  if (size(context) <= maxChars) return context;
  const c: AnalysisContext = { ...context, truncation: [...(context.truncation ?? [])] };
  const note = (m: string) => c.truncation!.push(m);

  while (size(c) > maxChars && c.errorLogs.length > 5) {
    const keep = Math.max(5, Math.floor(c.errorLogs.length / 2));
    note(`logs: cut to ${keep} to fit the size limit`);
    c.errorLogs = c.errorLogs.slice(0, keep);
  }
  if (size(c) > maxChars) {
    c.runbookExcerpts = c.runbookExcerpts.map((r) => ({ ...r, excerpt: r.excerpt.slice(0, 400) }));
    note('runbook excerpts shortened to fit the size limit');
  }
  if (size(c) > maxChars && c.similarIncidents.length) {
    c.similarIncidents = [];
    note('similar incidents dropped to fit the size limit');
  }
  if (size(c) > maxChars) {
    c.metrics = { latest: c.metrics.latest, recent: c.metrics.recent.slice(0, 2) };
    c.deployments = c.deployments.slice(0, 3);
    note('metric history and deployments shortened to fit the size limit');
  }
  if (size(c) > maxChars) {
    c.errorLogs = c.errorLogs.slice(0, 1);
    c.errorPatterns = c.errorPatterns.slice(0, 2);
    c.incident.description = c.incident.description ? c.incident.description.slice(0, 300) : null;
    note('context reduced to the essentials to fit the size limit');
  }
  return c;
}
