import { Router } from 'express';
import type { MeResponse } from '@opsflow/shared';
import { clearAuthCookie, requireAuth, setAuthCookie, signToken } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import { loginByEmailLimit, loginLimit, registerLimit } from '../../middleware/rateLimit';
import { LoginSchema, RegisterSchema } from './schemas';
import { authService } from './service';

export const authRouter = Router();

authRouter.post('/register', registerLimit, async (req, res) => {
  const input = parse(RegisterSchema, req.body);
  const { userId, organizationId } = await authService.register(input);
  setAuthCookie(res, signToken(userId, organizationId));
  res.status(201).json({ ok: true });
});

authRouter.post('/login', loginLimit, loginByEmailLimit, async (req, res) => {
  const input = parse(LoginSchema, req.body);
  const { userId, organizationId } = await authService.login(input);
  setAuthCookie(res, signToken(userId, organizationId));
  res.json({ ok: true });
});

authRouter.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => {
  const a = req.auth!;
  const me: MeResponse = {
    user: { id: a.userId, email: a.email, name: a.name },
    organization: { id: a.organizationId, name: a.organizationName },
    role: a.role,
  };
  res.json(me);
});
