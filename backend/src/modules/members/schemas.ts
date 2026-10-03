import { z } from 'zod';
export { AddMemberSchema, UpdateMemberSchema } from '@opsflow/shared';

export const MemberParamsSchema = z.object({ id: z.string().uuid() });
