import { Router } from 'express';
import { contextFrom } from '../../lib/context';
import { parse } from '../../lib/validate';
import { resolveServiceRefs } from '../../lib/serviceRefs';
import { ingestAuth } from '../../middleware/ingestAuth';
import { IngestMetricSchema } from './schemas';
import { metricsService } from './service';

export const metricsRouter = Router();

metricsRouter.post('/', ingestAuth('ingest'), async (req, res) => {
  const body = await resolveServiceRefs(req.auth!.organizationId, req.body, req.apiKey);
  const metric = await metricsService.ingest(contextFrom(req), parse(IngestMetricSchema, body));
  res.status(201).json({ metric });
});
