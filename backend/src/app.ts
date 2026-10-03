import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './lib/config';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestId } from './middleware/requestId';
import { authRouter } from './modules/auth/routes';
import { adminRouter } from './modules/admin/routes';
import { incidentsRouter } from './modules/incidents/routes';
import { membersRouter } from './modules/members/routes';
import { notificationsRouter } from './modules/notifications/routes';
import { projectsRouter } from './modules/projects/routes';
import { servicesRouter } from './modules/services/routes';

export function buildApp() {
  const app = express();

  app.use(requestId);
  app.use(helmet());
  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/members', membersRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/services', servicesRouter);
  app.use('/api/incidents', incidentsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/admin', adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
