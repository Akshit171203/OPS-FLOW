import type { Executor } from '../../../db/client';
import { logger } from '../../../lib/logger';
import { deploymentsRepository } from '../../deployments/repository';
import { incidentsRepository } from '../../incidents/repository';
import { logsRepository } from '../../logs/repository';
import { metricsRepository } from '../../metrics/repository';
import { runbooksRepository } from '../../runbooks/repository';
import { servicesRepository } from '../../services/repository';
import type { AIProvider } from '../provider';
import { errorSignature } from './builder';
import type { RawContextInput } from './types';

const HOUR = 3_600_000;
export const LOG_LOOKBACK_MS = 30 * 60_000; // logs from shortly before the incident started
export const DEPLOYMENT_LOOKBACK_MS = 48 * HOUR;
const FETCH_LOGS = 400; // read more than the cap so error patterns reflect real volume
const FETCH_SIMILAR = 100;

export type Evidence = Omit<RawContextInput, 'runbookChunks'>;

/**
 * Read everything the analysis may use, for ONE organization (every query is scoped by organization id).
 * Returns null if the incident does not exist in that organization.
 */
export async function gatherEvidence(
  ex: Executor,
  organizationId: string,
  incidentId: string,
  now = new Date(),
): Promise<Evidence | null> {
  const incident = await incidentsRepository.find(ex, organizationId, incidentId);
  if (!incident) return null;
  const service = await servicesRepository.find(ex, organizationId, incident.serviceId);
  if (!service) return null;

  const since = new Date(incident.startedAt.getTime() - LOG_LOOKBACK_MS);
  const [logs, deployments, metrics, similarCandidates] = await Promise.all([
    logsRepository.forAnalysis(ex, organizationId, incident.serviceId, since, FETCH_LOGS),
    deploymentsRepository.listForIncident(
      ex,
      organizationId,
      incident.id,
      incident.serviceId,
      new Date(incident.startedAt.getTime() - DEPLOYMENT_LOOKBACK_MS),
    ),
    metricsRepository.recent(ex, organizationId, incident.serviceId, 6),
    incidentsRepository.listResolvedForService(
      ex,
      organizationId,
      incident.serviceId,
      incident.id,
      FETCH_SIMILAR,
    ),
  ]);

  return {
    now,
    incident: {
      id: incident.id,
      title: incident.title,
      description: incident.description,
      severity: incident.severity,
      status: incident.status,
      priority: incident.priority,
      startedAt: incident.startedAt,
    },
    service: { name: service.name, projectName: service.projectName, status: service.status },
    logs,
    deployments,
    metrics,
    similarCandidates,
  };
}

/** What to look up in the runbooks: the incident title plus its most frequent error messages. */
export function runbookQuery(e: Evidence): string {
  const counts = new Map<string, number>();
  for (const l of e.logs)
    counts.set(errorSignature(l.message), (counts.get(errorSignature(l.message)) ?? 0) + 1);
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([sig]) => sig);
  return [e.incident.title, e.service.name, ...top].join('\n');
}

/**
 * Embed the query and fetch the closest runbook chunks. Runbooks improve the answer but are not
 * essential, so a failure here is logged and the analysis continues without them.
 */
export async function retrieveRunbooks(
  ex: Executor,
  organizationId: string,
  evidence: Evidence,
  provider: AIProvider,
  limit = 3,
): Promise<RawContextInput['runbookChunks']> {
  try {
    const { vector } = await provider.generateEmbedding(runbookQuery(evidence), 'query');
    const hits = await runbooksRepository.searchChunks(
      ex,
      organizationId,
      vector,
      provider.embeddingModel,
      limit,
    );
    return hits.map((h) => ({ runbookTitle: h.runbookTitle, content: h.content, score: h.score }));
  } catch (err) {
    logger.warn({ err }, 'runbook retrieval failed; continuing the analysis without runbooks');
    return [];
  }
}
