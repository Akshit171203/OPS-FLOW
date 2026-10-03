import { z } from 'zod';

export const roles = ['OWNER', 'ADMIN', 'ENGINEER', 'VIEWER'] as const;
export const RoleSchema = z.enum(roles);
export type Role = z.infer<typeof RoleSchema>;

export const roleRank: Record<Role, number> = { OWNER: 4, ADMIN: 3, ENGINEER: 2, VIEWER: 1 };

export const RegisterSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100),
  organizationName: z.string().min(1).max(100),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const AddMemberSchema = z.object({ email: z.string().email(), role: RoleSchema });
export const UpdateMemberSchema = z.object({ role: RoleSchema });

export interface ApiErrorBody {
  error: { code: string; message: string; requestId: string; details?: unknown };
}

export interface MeResponse {
  user: { id: string; email: string; name: string };
  organization: { id: string; name: string };
  role: Role;
}

export interface MemberDto {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: Role;
}

// ---------------------------------------------------------------------------
// Phase 2: core domain
// ---------------------------------------------------------------------------

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

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

export interface ProjectDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
}

export interface ServiceDto {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  slug: string;
  status: ServiceStatus;
  createdAt: string;
}

export interface IncidentDto {
  id: string;
  serviceId: string;
  serviceName: string;
  title: string;
  description: string | null;
  severity: Severity;
  status: IncidentStatus;
  priority: Priority;
  assignee: { id: string; name: string; email: string } | null;
  createdBy: string;
  startedAt: string;
  resolvedAt: string | null;
  version: number;
  allowedNextStatuses: IncidentStatus[];
  createdAt: string;
  updatedAt: string;
}

export interface IncidentEventDto {
  id: string;
  eventType: string;
  actor: { id: string; name: string };
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface IncidentCommentDto {
  id: string;
  body: string;
  author: { id: string; name: string };
  createdAt: string;
}

export interface IncidentDetailResponse {
  incident: IncidentDto;
  events: IncidentEventDto[];
  comments: IncidentCommentDto[];
}
