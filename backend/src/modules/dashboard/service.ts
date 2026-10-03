import type { DashboardDto } from '@opsflow/shared';
import { db } from '../../db/client';
import { cacheKeys, getOrSet } from '../../lib/cache';
import type { RequestContext } from '../../lib/context';
import { dashboardRepository as repo } from './repository';

export const DASHBOARD_TTL_SECONDS = 30;

async function compute(orgId: string): Promise<DashboardDto> {
  const [open, critical, degraded, recent, avg] = await Promise.all([
    repo.countOpen(db, orgId, false),
    repo.countOpen(db, orgId, true),
    repo.degradedServices(db, orgId),
    repo.recentDeployments(db, orgId, 5),
    repo.avgResolutionMinutes(db, orgId),
  ]);
  return {
    openIncidents: open,
    criticalIncidents: critical,
    degradedServices: degraded,
    recentDeployments: recent.map((d) => ({ ...d, deployedAt: d.deployedAt.toISOString() })),
    avgResolutionMinutes: avg === null ? null : Math.round(avg * 10) / 10,
    generatedAt: new Date().toISOString(),
  };
}

export const dashboardService = {
  /** Cached per organization for 30 seconds; invalidated when incidents, services, metrics or deployments change. */
  get(ctx: RequestContext): Promise<DashboardDto> {
    const orgId = ctx.actor.organizationId;
    return getOrSet(cacheKeys.dashboard(orgId), DASHBOARD_TTL_SECONDS, () => compute(orgId));
  },
};
