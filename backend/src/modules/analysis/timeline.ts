import type { Executor } from '../../db/client';
import { auditRepository } from '../audit/repository';
import { incidentsRepository } from '../incidents/repository';

/** Timeline entry plus audit log for an AI analysis step, attributed to the person who requested it. */
export async function recordAnalysisEvent(
  ex: Executor,
  a: { organizationId: string; incidentId: string; analysisId: string; actorId: string },
  type:
    | 'ai.analysis.requested'
    | 'ai.analysis.started'
    | 'ai.analysis.completed'
    | 'ai.analysis.failed',
  metadata: Record<string, unknown> = {},
) {
  const meta = { analysisId: a.analysisId, ...metadata };
  await incidentsRepository.insertEvent(ex, {
    organizationId: a.organizationId,
    incidentId: a.incidentId,
    actorId: a.actorId,
    eventType: type,
    metadata: meta,
  });
  await auditRepository.insertFor(
    ex,
    { organizationId: a.organizationId, actorId: a.actorId },
    { action: type, resourceType: 'incident', resourceId: a.incidentId, metadata: meta },
  );
}
