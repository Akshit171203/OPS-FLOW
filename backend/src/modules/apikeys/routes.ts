import { demoReadOnly } from '../../middleware/demoGuard';
import { Router } from 'express';
import { z } from 'zod';
import { apiKeyScopes } from '@opsflow/shared';
import { contextFrom } from '../../lib/context';
import { parse } from '../../lib/validate';
import { requireRole } from '../../middleware/auth';
import { IdParamsSchema } from '../projects/schemas';
import { apiKeysService } from './service';

const CreateApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(apiKeyScopes)).min(1).max(apiKeyScopes.length),
  serviceId: z.string().uuid().optional(),
});

export const apiKeysRouter = Router();

// Managing keys is an admin action done by a signed-in person, never with another key
apiKeysRouter.get('/', ...requireRole('ADMIN'), async (req, res) => {
  res.json({ keys: await apiKeysService.list(contextFrom(req)) });
});

apiKeysRouter.post('/', ...requireRole('ADMIN'), demoReadOnly, async (req, res) => {
  const input = parse(CreateApiKeySchema, req.body);
  const key = await apiKeysService.create(contextFrom(req), {
    ...input,
    scopes: [...new Set(input.scopes)],
  });
  res.status(201).json({ key });
});

apiKeysRouter.delete('/:id', ...requireRole('ADMIN'), demoReadOnly, async (req, res) => {
  const { id } = parse(IdParamsSchema, req.params);
  res.json({ key: await apiKeysService.revoke(contextFrom(req), id) });
});
