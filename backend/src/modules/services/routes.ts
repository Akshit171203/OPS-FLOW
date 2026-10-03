import { Router } from 'express';
import { contextFrom } from '../../lib/context';
import { parse } from '../../lib/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import { metricsService } from '../metrics/service';
import { IdParamsSchema } from '../projects/schemas';
import { CreateServiceSchema, ListServicesQuerySchema, UpdateServiceSchema } from './schemas';
import { servicesService } from './service';

export const servicesRouter = Router();

servicesRouter.get('/', requireAuth, async (req, res) => {
  const { projectId, ...page } = parse(ListServicesQuerySchema, req.query);
  res.json(await servicesService.list(contextFrom(req), page, projectId));
});

servicesRouter.post('/', ...requireRole('ADMIN'), async (req, res) => {
  const service = await servicesService.create(
    contextFrom(req),
    parse(CreateServiceSchema, req.body),
  );
  res.status(201).json({ service });
});

servicesRouter.patch('/:id', ...requireRole('ADMIN'), async (req, res) => {
  const { id } = parse(IdParamsSchema, req.params);
  const service = await servicesService.update(
    contextFrom(req),
    id,
    parse(UpdateServiceSchema, req.body),
  );
  res.json({ service });
});

servicesRouter.get('/health', requireAuth, async (req, res) => {
  res.json({ services: await metricsService.serviceHealth(contextFrom(req)) });
});

servicesRouter.get('/:id/metrics/latest', requireAuth, async (req, res) => {
  const { id } = parse(IdParamsSchema, req.params);
  res.json({ metric: await metricsService.latest(contextFrom(req), id) });
});
