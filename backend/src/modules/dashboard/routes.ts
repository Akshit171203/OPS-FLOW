import { Router } from 'express';
import { contextFrom } from '../../lib/context';
import { requireAuth } from '../../middleware/auth';
import { dashboardService } from './service';

export const dashboardRouter = Router();

dashboardRouter.get('/', requireAuth, async (req, res) => {
  res.json(await dashboardService.get(contextFrom(req)));
});
