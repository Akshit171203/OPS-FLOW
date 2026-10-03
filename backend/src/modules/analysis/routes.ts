import { Router } from 'express';
import { z } from 'zod';
import { contextFrom } from '../../lib/context';
import { parse } from '../../lib/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import { aiAnalysisLimit } from '../../middleware/rateLimit';
import { IdParamsSchema } from '../projects/schemas';
import { analysisService } from './service';

/** Mounted under /api/incidents: POST/GET /api/incidents/:id/ai-analysis */
export const incidentAnalysisRouter = Router();

incidentAnalysisRouter.post(
  '/:id/ai-analysis',
  ...requireRole('ENGINEER'),
  aiAnalysisLimit,
  async (req, res) => {
    const { id } = parse(IdParamsSchema, req.params);
    const started = await analysisService.start(contextFrom(req), id);
    res.status(202).json(started);
  },
);

incidentAnalysisRouter.get('/:id/ai-analysis', requireAuth, async (req, res) => {
  const { id } = parse(IdParamsSchema, req.params);
  res.json(await analysisService.get(contextFrom(req), id));
});

export const aiRouter = Router();

aiRouter.get('/usage', ...requireRole('ADMIN'), async (req, res) => {
  const { days } = parse(
    z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }),
    req.query,
  );
  res.json(await analysisService.usage(contextFrom(req), days));
});
