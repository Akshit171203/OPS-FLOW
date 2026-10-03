import { Router } from 'express';
import { contextFrom } from '../../lib/context';
import { parse } from '../../lib/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import { IdParamsSchema } from '../projects/schemas';
import {
  CreateDeploymentSchema,
  IncidentDeploymentsQuerySchema,
  LinkDeploymentSchema,
  ListDeploymentsQuerySchema,
} from './schemas';
import { deploymentsService } from './service';

export const deploymentsRouter = Router();

deploymentsRouter.post('/', ...requireRole('ENGINEER'), async (req, res) => {
  const deployment = await deploymentsService.create(
    contextFrom(req),
    parse(CreateDeploymentSchema, req.body),
  );
  res.status(201).json({ deployment });
});

deploymentsRouter.get('/', requireAuth, async (req, res) => {
  const { serviceId, ...page } = parse(ListDeploymentsQuerySchema, req.query);
  res.json(await deploymentsService.list(contextFrom(req), page, serviceId));
});

/** Mounted under /api/incidents so the URLs read /api/incidents/:id/deployments. */
export const incidentDeploymentsRouter = Router();

incidentDeploymentsRouter.get('/:id/deployments', requireAuth, async (req, res) => {
  const { id } = parse(IdParamsSchema, req.params);
  const { windowHours } = parse(IncidentDeploymentsQuerySchema, req.query);
  res.json(await deploymentsService.listForIncident(contextFrom(req), id, windowHours));
});

incidentDeploymentsRouter.post('/:id/deployments', ...requireRole('ENGINEER'), async (req, res) => {
  const { id } = parse(IdParamsSchema, req.params);
  const { deploymentId } = parse(LinkDeploymentSchema, req.body);
  res.status(201).json({
    incident: await deploymentsService.linkToIncident(contextFrom(req), id, deploymentId),
  });
});
