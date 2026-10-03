import { Router } from 'express';
import { contextFrom } from '../../lib/context';
import { parse } from '../../lib/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import { IdParamsSchema } from '../projects/schemas';
import {
  AddCommentSchema,
  AssignIncidentSchema,
  ChangeStatusSchema,
  CreateIncidentSchema,
  ListIncidentsQuerySchema,
  UpdateIncidentSchema,
} from './schemas';
import { incidentsService } from './service';

export const incidentsRouter = Router();

incidentsRouter.get('/', requireAuth, async (req, res) => {
  res.json(
    await incidentsService.list(contextFrom(req), parse(ListIncidentsQuerySchema, req.query)),
  );
});

incidentsRouter.post('/', ...requireRole('ENGINEER'), async (req, res) => {
  const incident = await incidentsService.create(
    contextFrom(req),
    parse(CreateIncidentSchema, req.body),
  );
  res.status(201).json({ incident });
});

incidentsRouter.get('/:id', requireAuth, async (req, res) => {
  const { id } = parse(IdParamsSchema, req.params);
  res.json(await incidentsService.get(contextFrom(req), id));
});

incidentsRouter.patch('/:id', ...requireRole('ENGINEER'), async (req, res) => {
  const { id } = parse(IdParamsSchema, req.params);
  const incident = await incidentsService.update(
    contextFrom(req),
    id,
    parse(UpdateIncidentSchema, req.body),
  );
  res.json({ incident });
});

incidentsRouter.patch('/:id/assignee', ...requireRole('ENGINEER'), async (req, res) => {
  const { id } = parse(IdParamsSchema, req.params);
  const incident = await incidentsService.assign(
    contextFrom(req),
    id,
    parse(AssignIncidentSchema, req.body),
  );
  res.json({ incident });
});

incidentsRouter.patch('/:id/status', ...requireRole('ENGINEER'), async (req, res) => {
  const { id } = parse(IdParamsSchema, req.params);
  const incident = await incidentsService.changeStatus(
    contextFrom(req),
    id,
    parse(ChangeStatusSchema, req.body),
  );
  res.json({ incident });
});

incidentsRouter.post('/:id/comments', ...requireRole('ENGINEER'), async (req, res) => {
  const { id } = parse(IdParamsSchema, req.params);
  const comment = await incidentsService.addComment(
    contextFrom(req),
    id,
    parse(AddCommentSchema, req.body),
  );
  res.status(201).json({ comment });
});
