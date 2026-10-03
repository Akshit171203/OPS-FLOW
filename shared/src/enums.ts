export const serviceStatuses = ['HEALTHY', 'DEGRADED', 'DOWN', 'UNKNOWN'] as const;
export type ServiceStatus = (typeof serviceStatuses)[number];

export const severities = ['SEV1', 'SEV2', 'SEV3', 'SEV4'] as const;
export type Severity = (typeof severities)[number];

export const priorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type Priority = (typeof priorities)[number];

export const incidentStatuses = [
  'OPEN',
  'INVESTIGATING',
  'MITIGATING',
  'RESOLVED',
  'CLOSED',
] as const;
export type IncidentStatus = (typeof incidentStatuses)[number];

/** The single source of truth for the incident lifecycle; used by the API and the UI. */
export const incidentTransitions: Record<IncidentStatus, readonly IncidentStatus[]> = {
  OPEN: ['INVESTIGATING'],
  INVESTIGATING: ['MITIGATING', 'RESOLVED'],
  MITIGATING: ['RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
};
