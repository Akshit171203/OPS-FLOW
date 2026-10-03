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
