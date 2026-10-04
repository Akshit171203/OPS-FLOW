import { Router } from 'express';
import { contextFrom } from '../../lib/context';
import { parse } from '../../lib/validate';
import { requireAuth } from '../../middleware/auth';
import { ingestAuth } from '../../middleware/ingestAuth';
import { resolveServiceRefs } from '../../lib/serviceRefs';
import { ingestLogsLimit } from '../../middleware/rateLimit';
import { IngestLogsSchema, SearchLogsQuerySchema } from './schemas';
import { logsService } from './service';

export const logsRouter = Router();

logsRouter.post('/', ingestAuth('ingest'), ingestLogsLimit, async (req, res) => {
  const body = await resolveServiceRefs(req.auth!.organizationId, req.body, req.apiKey);
  const items = parse(IngestLogsSchema, body);
  res.status(201).json(await logsService.ingest(contextFrom(req), items));
});

logsRouter.get('/', requireAuth, async (req, res) => {
  res.json(await logsService.search(contextFrom(req), parse(SearchLogsQuerySchema, req.query)));
});
