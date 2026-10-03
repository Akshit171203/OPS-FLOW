import { Router } from 'express';
import { contextFrom } from '../../lib/context';
import { parse } from '../../lib/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import { IngestLogsSchema, SearchLogsQuerySchema } from './schemas';
import { logsService } from './service';

export const logsRouter = Router();

logsRouter.post('/', ...requireRole('ENGINEER'), async (req, res) => {
  const items = parse(IngestLogsSchema, req.body);
  res.status(201).json(await logsService.ingest(contextFrom(req), items));
});

logsRouter.get('/', requireAuth, async (req, res) => {
  res.json(await logsService.search(contextFrom(req), parse(SearchLogsQuerySchema, req.query)));
});
