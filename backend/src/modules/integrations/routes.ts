import { Router } from 'express';
import type { AlertResultDto } from '@opsflow/shared';
import { contextFrom } from '../../lib/context';
import { parse } from '../../lib/validate';
import { ingestAuth } from '../../middleware/ingestAuth';
import { alertsLimit } from '../../middleware/rateLimit';
import { alertsService } from './alerts';
import {
  AlertmanagerSchema,
  GenericAlertSchema,
  fromAlertmanager,
  sourceFromQuery,
} from './adapters';

export const integrationsRouter = Router();

/** Our simple alert format. 201 when it opened a new incident, 200 when it attached, noted or was ignored. */
integrationsRouter.post('/alerts', ingestAuth('alerts'), alertsLimit, async (req, res) => {
  const alert = parse(GenericAlertSchema, req.body);
  const result = await alertsService.handle(contextFrom(req), req.apiKey!, alert);
  res.status(result.action === 'created' ? 201 : 200).json(result);
});

/** Prometheus Alertmanager and Grafana webhooks. Add ?source=grafana to label where they came from. */
integrationsRouter.post('/alertmanager', ingestAuth('alerts'), alertsLimit, async (req, res) => {
  const payload = parse(AlertmanagerSchema, req.body);
  const ctx = contextFrom(req);
  const results: AlertResultDto[] = [];
  for (const alert of fromAlertmanager(payload, sourceFromQuery(req.query.source))) {
    results.push(await alertsService.handle(ctx, req.apiKey!, alert));
  }
  res.status(results.some((r) => r.action === 'created') ? 201 : 200).json({ results });
});
