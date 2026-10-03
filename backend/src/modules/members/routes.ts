import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import { AddMemberSchema, MemberParamsSchema, UpdateMemberSchema } from './schemas';
import { membersService } from './service';

export const membersRouter = Router();

membersRouter.get('/', requireAuth, async (req, res) => {
  res.json({ members: await membersService.list(req.auth!) });
});

membersRouter.post('/', ...requireRole('ADMIN'), async (req, res) => {
  const input = parse(AddMemberSchema, req.body);
  const member = await membersService.add(req.auth!, input);
  res.status(201).json({ member });
});

membersRouter.patch('/:id', ...requireRole('ADMIN'), async (req, res) => {
  const { id } = parse(MemberParamsSchema, req.params);
  const { role } = parse(UpdateMemberSchema, req.body);
  res.json({ member: await membersService.changeRole(req.auth!, id, role) });
});
