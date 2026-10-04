import { Router } from 'express';
import type { MeResponse } from '@opsflow/shared';
import {
  clearAuthCookie,
  COOKIE_NAME,
  requireAuth,
  setAuthCookie,
  signToken,
} from '../../middleware/auth';
import { parse } from '../../lib/validate';
import { isDemoAccount } from '../../middleware/demoGuard';
import {
  loginByEmailLimit,
  loginLimit,
  registerByEmailLimit,
  registerLimit,
} from '../../middleware/rateLimit';
import { LoginSchema, RegisterSchema } from './schemas';
import { revokeSession } from './sessions';
import { authService } from './service';

export const authRouter = Router();

authRouter.post('/register', registerLimit, registerByEmailLimit, async (req, res) => {
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

authRouter.post('/logout', async (req, res) => {
  await revokeSession(req.cookies?.[COOKIE_NAME] as string | undefined);
  clearAuthCookie(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => {
  const a = req.auth!;
  const me: MeResponse = {
    user: { id: a.userId, email: a.email, name: a.name },
    organization: { id: a.organizationId, name: a.organizationName },
    role: a.role,
    ...(isDemoAccount(a.email) ? { demo: true } : {}),
  };
  res.json(me);
});
