import type {
  AiAnalysisDto,
  AnalysisRealtimeData,
  AnalysisStep,
  RealtimeEventName,
} from '@opsflow/shared';
import { publishRealtime, rooms } from '../../realtime/channel';

/** Live progress for everyone looking at the incident or the organization. Best effort. */
export function emitAnalysisRealtime(
  organizationId: string,
  incidentId: string,
  event: Extract<RealtimeEventName, `ai.${string}`>,
  data: Omit<AnalysisRealtimeData, 'incidentId'> & {
    analysis?: AiAnalysisDto;
    step?: AnalysisStep;
  },
): Promise<void> {
  return publishRealtime([rooms.org(organizationId), rooms.incident(incidentId)], event, {
    incidentId,
    ...data,
  });
}
