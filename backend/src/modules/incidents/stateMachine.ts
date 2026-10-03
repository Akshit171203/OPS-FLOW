import { incidentTransitions, type IncidentStatus } from '@opsflow/shared';
import { ConflictError } from '../../lib/errors';

export function allowedTransitions(from: IncidentStatus): readonly IncidentStatus[] {
  return incidentTransitions[from];
}

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return incidentTransitions[from].includes(to);
}

/** Pure check: throws INVALID_STATUS_TRANSITION (409) listing what is allowed from `from`. */
export function assertTransition(from: IncidentStatus, to: IncidentStatus): void {
  if (canTransition(from, to)) return;
  const allowed = allowedTransitions(from);
  throw new ConflictError(
    `Cannot move an incident from ${from} to ${to}. Allowed: ${allowed.length ? allowed.join(', ') : 'none'}`,
    'INVALID_STATUS_TRANSITION',
    { from, to, allowed },
  );
}
