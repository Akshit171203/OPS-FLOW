import type { SimulateResult } from '@opsflow/shared';
import { db } from '../../db/client';
import type { RequestContext } from '../../lib/context';
import { deploymentsRepository } from '../deployments/repository';
import { deploymentsService } from '../deployments/service';
import { incidentsService } from '../incidents/service';
import { logsService } from '../logs/service';
import type { LogInput } from '../logs/schemas';
import { metricsService } from '../metrics/service';
import { projectsRepository } from '../projects/repository';
import { projectsService } from '../projects/service';
import { servicesRepository } from '../services/repository';
import { servicesService } from '../services/service';

const MINUTE = 60_000;
export const DEMO_SERVICE_SLUG = 'payment-service';
export const DEMO_VERSION = 'v2.4.0';

/** Finds the payment service, creating a project and the service if this organization has none. */
async function ensurePaymentService(ctx: RequestContext): Promise<string> {
  const orgId = ctx.actor.organizationId;
  const existing = await servicesRepository.findBySlug(db, orgId, DEMO_SERVICE_SLUG);
  if (existing) return existing.id;
  const project =
    (await projectsRepository.findBySlug(db, orgId, 'platform')) ??
    (await projectsService.create(ctx, { name: 'Platform', slug: 'platform' }));
  const service = await servicesService.create(ctx, {
    projectId: project.id,
    name: 'Payment Service',
    slug: DEMO_SERVICE_SLUG,
    status: 'HEALTHY',
  });
  return service.id;
}

/** The v2.4.0 rollout that caused the outage: reuse a recent one, else record it as 15 minutes ago. */
async function ensureBadDeployment(ctx: RequestContext, serviceId: string) {
  const { rows } = await deploymentsRepository.list(
    db,
    ctx.actor.organizationId,
    { page: 1, limit: 10 },
    serviceId,
  );
  const recent = rows.find(
    (d) => d.version === DEMO_VERSION && Date.now() - d.deployedAt.getTime() < 3 * 60 * MINUTE,
  );
  if (recent) return { id: recent.id };
  return deploymentsService.create(ctx, {
    serviceId,
    version: DEMO_VERSION,
    commitSha: 'a1b2c3d4e5f6',
    environment: 'production',
    deployedBy: 'ci-pipeline',
    deployedAt: new Date(Date.now() - 15 * MINUTE),
    status: 'SUCCESS',
  });
}

// Two of every three error lines are the pool-exhaustion symptom the demo is built around.
const POOL_MESSAGES = [
  (i: number) => `Connection pool exhausted: active=50 max=50 waiting=${12 + i}`,
  (i: number) =>
    `Connection pool exhausted: could not acquire connection after 30000ms (waiting=${10 + i})`,
  (i: number) => `Payment authorization failed for order ord_${48200 + i}: upstream timeout`,
];

/** About 50 realistic log lines for the outage, deploy time to now, dominated by pool exhaustion. */
export function buildOutageLogs(
  serviceId: string,
  incidentId: string,
  now = Date.now(),
): LogInput[] {
  const start = now - 14 * MINUTE;
  const count = 50;
  return Array.from({ length: count }, (_, i) => {
    const timestamp = new Date(start + Math.round((i * 13.5 * MINUTE) / count));
    const requestId = `req-${(0x9a00 + i * 7).toString(16)}`;
    let level: LogInput['level'] = 'ERROR';
    let message = POOL_MESSAGES[i % POOL_MESSAGES.length]!(i);
    if (i < 4) {
      level = 'INFO';
      message = `Deployment ${DEMO_VERSION} rolled out; new connection pool settings applied (max=50)`;
    } else if (i % 9 === 0) {
      level = 'WARN';
      message = `Slow query detected: SELECT * FROM payments WHERE status = $1 (${2400 + i * 37}ms)`;
    }
    return {
      serviceId,
      incidentId,
      level,
      message,
      requestId,
      metadata: { pod: `payment-${(i % 3) + 1}` },
      timestamp,
    };
  });
}

/**
 * Create a believable payment outage through the same service functions real use goes through,
 * so events, the timeline, the audit log and live updates all behave exactly as in production.
 */
export async function simulatePaymentIncident(ctx: RequestContext): Promise<SimulateResult> {
  const serviceId = await ensurePaymentService(ctx);
  const deployment = await ensureBadDeployment(ctx, serviceId);

  const created = await incidentsService.create(ctx, {
    serviceId,
    title: 'Payment failures spiking after v2.4.0 rollout',
    description:
      'Checkout is failing for a third of customers. Error rate rose within minutes of the v2.4.0 deployment; logs show database connection pool exhaustion.',
    severity: 'SEV1',
    priority: 'URGENT',
  });

  const now = Date.now();
  for (const [minutesAgo, errorRate, latencyMs, requestsPerMin] of [
    [14, 0.01, 180, 640],
    [9, 0.12, 2100, 590],
    [4, 0.27, 4300, 480],
    [0, 0.34, 5200, 410],
  ] as const) {
    await metricsService.ingest(ctx, {
      serviceId,
      errorRate,
      latencyMs,
      requestsPerMin,
      capturedAt: new Date(now - minutesAgo * MINUTE),
    });
  }

  const logs = buildOutageLogs(serviceId, created.id, now);
  await logsService.ingest(ctx, logs);

  const incident = await deploymentsService.linkToIncident(ctx, created.id, deployment.id);
  const linked = (await deploymentsService.listForIncident(ctx, created.id, 48)).deployments.find(
    (d) => d.id === deployment.id,
  )!;
  return { incident, logsInserted: logs.length, deployment: linked };
}
