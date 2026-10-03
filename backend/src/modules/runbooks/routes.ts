import { Router } from 'express';
import { z } from 'zod';
import { contextFrom } from '../../lib/context';
import { PaginationSchema } from '../../lib/pagination';
import { parse } from '../../lib/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import { IdParamsSchema } from '../projects/schemas';
import { runbooksService } from './service';

const CreateRunbookSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(50_000),
  serviceTag: z.string().trim().min(1).max(100).optional(),
});
const UpdateRunbookSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(50_000),
    serviceTag: z.string().trim().min(1).max(100).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export const runbooksRouter = Router();

runbooksRouter.get('/', requireAuth, async (req, res) => {
  res.json(await runbooksService.list(contextFrom(req), parse(PaginationSchema, req.query)));
});

runbooksRouter.post('/reindex-all', ...requireRole('ADMIN'), async (req, res) => {
  res.status(202).json(await runbooksService.reindexAll(contextFrom(req)));
});

runbooksRouter.post('/', ...requireRole('ADMIN'), async (req, res) => {
  const runbook = await runbooksService.create(
    contextFrom(req),
    parse(CreateRunbookSchema, req.body),
  );
  res.status(201).json({ runbook });
});

runbooksRouter.get('/:id', requireAuth, async (req, res) => {
  const { id } = parse(IdParamsSchema, req.params);
  res.json({ runbook: await runbooksService.get(contextFrom(req), id) });
});

runbooksRouter.patch('/:id', ...requireRole('ADMIN'), async (req, res) => {
  const { id } = parse(IdParamsSchema, req.params);
  res.json({
    runbook: await runbooksService.update(
      contextFrom(req),
      id,
      parse(UpdateRunbookSchema, req.body),
    ),
  });
});
