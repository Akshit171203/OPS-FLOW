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

import type { IncidentStatus, Priority, ServiceStatus, Severity } from './enums';

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

export * from './enums';
export * from './events';

import type { DeploymentStatus, LogLevel } from './enums';

export interface LogDto {
  id: string;
  serviceId: string;
  serviceName: string;
  incidentId: string | null;
  level: LogLevel;
  message: string;
  requestId: string | null;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface DeploymentDto {
  id: string;
  serviceId: string;
  serviceName: string;
  version: string;
  commitSha: string;
  environment: string;
  deployedBy: string;
  deployedAt: string;
  status: DeploymentStatus;
  /** Set when listing for an incident: has this deployment been linked to it? */
  linked?: boolean;
}

export interface MetricDto {
  id: string;
  serviceId: string;
  errorRate: number;
  latencyMs: number;
  requestsPerMin: number;
  healthStatus: ServiceStatus;
  capturedAt: string;
}

export interface SimulateResult {
  incident: IncidentDto;
  logsInserted: number;
  deployment: DeploymentDto;
}

/** Payload of the realtime incident events. */
export interface IncidentRealtimeData {
  incidentId: string;
  incident?: IncidentDto;
  commentId?: string;
}
