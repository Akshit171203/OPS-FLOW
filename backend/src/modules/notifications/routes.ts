import { Router } from 'express';
import { z } from 'zod';
import { contextFrom } from '../../lib/context';
import { PaginationSchema } from '../../lib/pagination';
import { parse } from '../../lib/validate';
import { requireAuth } from '../../middleware/auth';
import { IdParamsSchema } from '../projects/schemas';
import { notificationsService } from './service';

const ListQuerySchema = PaginationSchema.extend({
  unread: z.enum(['true', 'false']).default('false'),
});

export const notificationsRouter = Router();

notificationsRouter.get('/', requireAuth, async (req, res) => {
  const { unread, ...page } = parse(ListQuerySchema, req.query);
  res.json(await notificationsService.list(contextFrom(req), page, unread === 'true'));
});

notificationsRouter.patch('/:id/read', requireAuth, async (req, res) => {
  const { id } = parse(IdParamsSchema, req.params);
  res.json({ notification: await notificationsService.markRead(contextFrom(req), id) });
});
