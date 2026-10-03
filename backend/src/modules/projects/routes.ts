import { Router } from 'express';
import { contextFrom } from '../../lib/context';
import { PaginationSchema } from '../../lib/pagination';
import { parse } from '../../lib/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import { CreateProjectSchema, IdParamsSchema, UpdateProjectSchema } from './schemas';
import { projectsService } from './service';

export const projectsRouter = Router();

projectsRouter.get('/', requireAuth, async (req, res) => {
  res.json(await projectsService.list(contextFrom(req), parse(PaginationSchema, req.query)));
});

projectsRouter.post('/', ...requireRole('ADMIN'), async (req, res) => {
  const project = await projectsService.create(
    contextFrom(req),
    parse(CreateProjectSchema, req.body),
  );
  res.status(201).json({ project });
});

projectsRouter.patch('/:id', ...requireRole('ADMIN'), async (req, res) => {
  const { id } = parse(IdParamsSchema, req.params);
  const project = await projectsService.update(
    contextFrom(req),
    id,
    parse(UpdateProjectSchema, req.body),
  );
  res.json({ project });
});
