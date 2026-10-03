import type { IncidentStatus, Priority, ServiceStatus, Severity } from '@opsflow/shared';

/** Everything the model is allowed to see about an incident. Bounded, redacted, single organization. */
export interface AnalysisContext {
  incident: {
    id: string;
    title: string;
    description: string | null;
    severity: Severity;
    status: IncidentStatus;
    priority: Priority;
    startedAt: string;
    minutesOpen: number;
  };
  service: { name: string; project: string; status: ServiceStatus };
  errorPatterns: {
    signature: string;
    count: number;
    sample: string;
    firstSeen: string;
    lastSeen: string;
  }[];
  errorLogs: { timestamp: string; level: string; message: string }[];
  deployments: {
    version: string;
    commitSha: string;
    environment: string;
    status: string;
    deployedAt: string;
    minutesBeforeIncident: number;
    linkedToIncident: boolean;
  }[];
  metrics: {
    latest: MetricPoint | null;
    recent: MetricPoint[];
  };
  similarIncidents: {
    title: string;
    severity: Severity;
    status: IncidentStatus;
    resolutionMinutes: number | null;
    similarity: number;
  }[];
  runbookExcerpts: { runbook: string; excerpt: string; relevance: number }[];
  /** Present when caps removed data, so the model knows the picture may be incomplete. */
  truncation?: string[];
}

export interface MetricPoint {
  capturedAt: string;
  errorRate: number;
  latencyMs: number;
  requestsPerMin: number;
  health: ServiceStatus;
}

/** Unbounded inputs as read from the database; the builder applies every cap. */
export interface RawContextInput {
  now: Date;
  incident: {
    id: string;
    title: string;
    description: string | null;
    severity: Severity;
    status: IncidentStatus;
    priority: Priority;
    startedAt: Date;
  };
  service: { name: string; projectName: string; status: ServiceStatus };
  logs: { timestamp: Date; level: string; message: string }[];
  deployments: {
    version: string;
    commitSha: string;
    environment: string;
    status: string;
    deployedAt: Date;
    linked: boolean;
  }[];
  metrics: {
    capturedAt: Date;
    errorRate: number;
    latencyMs: number;
    requestsPerMin: number;
    healthStatus: ServiceStatus;
  }[];
  similarCandidates: {
    title: string;
    severity: Severity;
    status: IncidentStatus;
    startedAt: Date;
    resolvedAt: Date | null;
  }[];
  runbookChunks: { runbookTitle: string; content: string; score: number }[];
}

export interface ContextCaps {
  maxLogs: number;
  maxLogChars: number;
  maxPatterns: number;
  maxDeployments: number;
  maxMetrics: number;
  maxSimilar: number;
  maxRunbookChunks: number;
  maxRunbookChars: number;
  maxDescriptionChars: number;
  /** Hard ceiling on the serialized size of the whole context. */
  maxTotalChars: number;
}

export const DEFAULT_CAPS: ContextCaps = {
  maxLogs: 50,
  maxLogChars: 300,
  maxPatterns: 5,
  maxDeployments: 10,
  maxMetrics: 6,
  maxSimilar: 3,
  maxRunbookChunks: 3,
  maxRunbookChars: 1200,
  maxDescriptionChars: 2000,
  maxTotalChars: 24_000,
};
