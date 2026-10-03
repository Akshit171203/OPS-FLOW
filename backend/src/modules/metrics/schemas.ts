import { z } from 'zod';
import { serviceStatuses } from '@opsflow/shared';

export const IngestMetricSchema = z.object({
  serviceId: z.string().uuid(),
  errorRate: z.number().min(0).max(1),
  latencyMs: z.number().int().min(0).max(600_000),
  requestsPerMin: z.number().int().min(0),
  healthStatus: z.enum(serviceStatuses).optional(),
  capturedAt: z.coerce.date().optional(),
});
export type IngestMetricInput = z.infer<typeof IngestMetricSchema>;
