import { z } from 'zod';
import { logLevels } from '@opsflow/shared';

export const MAX_LOG_BATCH = 500;

const LogInputSchema = z.object({
  serviceId: z.string().uuid(),
  incidentId: z.string().uuid().optional(),
  level: z.enum(logLevels),
  message: z.string().min(1).max(5000),
  requestId: z.string().max(128).optional(),
  metadata: z.record(z.unknown()).optional(),
  timestamp: z.coerce.date().optional(),
});
export type LogInput = z.infer<typeof LogInputSchema>;

/** One log object, or `{ logs: [...] }` for a batch of up to MAX_LOG_BATCH. */
export const IngestLogsSchema = z
  .union([z.object({ logs: z.array(LogInputSchema).min(1).max(MAX_LOG_BATCH) }), LogInputSchema])
  .transform((v): LogInput[] => ('logs' in v ? v.logs : [v]));

export const SearchLogsQuerySchema = z.object({
  level: z.enum(logLevels).optional(),
  serviceId: z.string().uuid().optional(),
  incidentId: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type SearchLogsQuery = z.infer<typeof SearchLogsQuerySchema>;
