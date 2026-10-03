import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './lib/config';
import { checkReadiness } from './lib/health';
import { csrfProtection } from './middleware/csrf';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestId } from './middleware/requestId';
import { authRouter } from './modules/auth/routes';
import { adminRouter } from './modules/admin/routes';
import { dashboardRouter } from './modules/dashboard/routes';
import { demoRouter } from './modules/demo/routes';
import { deploymentsRouter, incidentDeploymentsRouter } from './modules/deployments/routes';
import { aiRouter, incidentAnalysisRouter } from './modules/analysis/routes';
import { incidentsRouter } from './modules/incidents/routes';
import { logsRouter } from './modules/logs/routes';
import { membersRouter } from './modules/members/routes';
import { metricsRouter } from './modules/metrics/routes';
import { notificationsRouter } from './modules/notifications/routes';
import { projectsRouter } from './modules/projects/routes';
import { runbooksRouter } from './modules/runbooks/routes';
import { servicesRouter } from './modules/services/routes';

export function buildApp() {
  const app = express();

  app.set('trust proxy', config.TRUST_PROXY);
  app.use(requestId);
  // This is a JSON API: lock the browser down as far as it goes.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  // Authenticated JSON must never be stored by browsers or intermediaries.
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // Only our web origin may make credentialed cross-origin calls; any other Origin gets no CORS headers.
  app.use(
    cors({
      origin: (origin, callback) => callback(null, !origin || origin === config.WEB_ORIGIN),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['content-type', 'x-requested-with', 'x-request-id'],
      maxAge: 600,
    }),
  );
  // Log ingestion is the only endpoint that legitimately takes large bodies; it gets its own cap,
  // parsed first so the small global limit below does not apply to it.
  app.use('/api/logs', express.json({ limit: '1mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(csrfProtection);

  // Liveness: the process is up. Says nothing about dependencies.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Readiness: Postgres and Redis answer and we are not shutting down.
  app.get('/ready', async (_req, res) => {
    const readiness = await checkReadiness();
    res
      .status(readiness.ready ? 200 : 503)
      .json({ status: readiness.ready ? 'ready' : 'unavailable', checks: readiness.checks });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/members', membersRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/services', servicesRouter);
  app.use('/api/incidents', incidentDeploymentsRouter);
  app.use('/api/incidents', incidentAnalysisRouter);
  app.use('/api/incidents', incidentsRouter);
  app.use('/api/logs', logsRouter);
  app.use('/api/deployments', deploymentsRouter);
  app.use('/api/metrics', metricsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/demo', demoRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/runbooks', runbooksRouter);
  app.use('/api/ai', aiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
