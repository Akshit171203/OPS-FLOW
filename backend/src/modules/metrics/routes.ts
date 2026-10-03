import { Router } from 'express';
import { contextFrom } from '../../lib/context';
import { parse } from '../../lib/validate';
import { requireRole } from '../../middleware/auth';
import { IngestMetricSchema } from './schemas';
import { metricsService } from './service';

export const metricsRouter = Router();

metricsRouter.post('/', ...requireRole('ENGINEER'), async (req, res) => {
  const metric = await metricsService.ingest(contextFrom(req), parse(IngestMetricSchema, req.body));
  res.status(201).json({ metric });
});
