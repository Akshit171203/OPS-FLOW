'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Flame, Rocket } from 'lucide-react';
import {
  roleRank,
  type DashboardDto,
  type IncidentDto,
  type Paginated,
  type ServiceDto,
  type SimulateResult,
} from '@opsflow/shared';
import { Button, buttonClass, linkClass } from '@/components/ui';
import {
  EmptyState,
  ErrorState,
  LoadingRegion,
  PageHeader,
  Panel,
  Skeleton,
  StatStrip,
} from '@/components/feedback';
import { AreaTrend } from '@/components/charts';
import { StatusDot } from '@/components/StatusDot';
import { eventIcon } from '@/components/eventIcon';
import { useToast } from '@/components/toast';
import { activityVerb } from '@/lib/activity';
import { api } from '@/lib/api';
import { formatDuration, timeAgo } from '@/lib/format';
import { useMe } from '@/lib/me-context';
import { useReconnect, useSocketEvent } from '@/lib/socket';
import { useFetch } from '@/lib/useFetch';
import { usePageTitle } from '@/lib/usePageTitle';

function DashboardSkeleton() {
  return (
    <LoadingRegion label="Loading dashboard">
      <Skeleton className="h-28" />
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-72 lg:col-span-2" />
        <Skeleton className="h-72" />
      </div>
    </LoadingRegion>
  );
}

const DAY = 24 * 60 * 60 * 1000;

/** Incidents started per day for the last 7 days, oldest first. */
function perDay(incidents: IncidentDto[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const start = today.getTime() - (6 - i) * DAY;
    const value = incidents.filter((inc) => {
      const t = new Date(inc.startedAt).getTime();
      return t >= start && t < start + DAY;
    }).length;
    return {
      label: new Date(start).toLocaleDateString(undefined, { weekday: 'short' }),
      value,
    };
  });
}

export default function DashboardPage() {
  usePageTitle('Dashboard');
  const me = useMe();
  const router = useRouter();
  const toast = useToast();
  const isAdmin = roleRank[me.role] >= roleRank.ADMIN;
  const dash = useFetch<DashboardDto>('/api/dashboard');
  const services = useFetch<Paginated<ServiceDto>>('/api/services?limit=100');
  const history = useFetch<Paginated<IncidentDto>>('/api/incidents?limit=100');
  const [simulating, setSimulating] = useState(false);

  // The dashboard follows the organization live: any incident change refreshes it
  const reloadAll = () => {
    dash.reload();
    services.reload();
    history.reload();
  };
  useSocketEvent('incident.created', reloadAll);
  useSocketEvent('incident.updated', reloadAll);
  useSocketEvent('incident.status_changed', reloadAll);
  useReconnect(reloadAll);

  async function simulate() {
    setSimulating(true);
    try {
      const r = await api<SimulateResult>('/api/demo/simulate-incident', { method: 'POST' });
      toast.success('Simulated a payment outage.');
      router.push(`/incidents/${r.incident.id}`);
    } catch (e) {
      toast.error(e, 'Could not simulate an outage.');
      setSimulating(false);
    }
  }

  const d = dash.data;
  const week = useMemo(() => perDay(history.data?.items ?? []), [history.data]);
  const weekTotal = week.reduce((n, p) => n + p.value, 0);
  const quiet =
    d && d.openIncidents === 0 && d.recentActivity.length === 0 && d.recentDeployments.length === 0;
  const allClear = d && d.openIncidents === 0 && d.degradedServices.length === 0;
  const allServices = services.data?.items ?? [];
  const healthy = allServices.filter((s) => s.status === 'HEALTHY').length;
  const canCreate = roleRank[me.role] >= roleRank.ENGINEER;

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <StatusDot
              status={
                !d ? 'UNKNOWN' : allClear ? 'HEALTHY' : d.criticalIncidents ? 'DOWN' : 'DEGRADED'
              }
            />
            <span className="font-medium text-ink">
              {!d
                ? 'Loading…'
                : allClear
                  ? 'All systems operational'
                  : `${d.openIncidents} open ${d.openIncidents === 1 ? 'incident needs' : 'incidents need'} attention`}
            </span>
            <span aria-hidden="true">·</span>
            <span>{me.organization.name}</span>
          </span>
        }
        actions={
          <>
            {isAdmin && (
              <Button
                variant="secondary"
                onClick={simulate}
                loading={simulating}
                loadingText="Simulating…"
              >
                <Flame className="h-4 w-4" aria-hidden="true" />
                Simulate outage
              </Button>
            )}
            {canCreate && (
              <Link href="/incidents/new" className={buttonClass}>
                New incident
              </Link>
            )}
          </>
        }
      />

      {dash.error && !d ? (
        <ErrorState message={dash.error} onRetry={dash.reload} />
      ) : !d ? (
        <DashboardSkeleton />
      ) : quiet ? (
        <EmptyState
          title="Nothing to show yet"
          description={
            isAdmin
              ? 'No incidents, deployments or activity yet. Connect your systems under Integrations so alerts and deploys arrive on their own, or simulate an outage to see the whole flow.'
              : 'No incidents, deployments or activity yet.'
          }
          action={
            isAdmin ? (
              <Button onClick={simulate} loading={simulating} loadingText="Simulating…">
                Simulate outage
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          <StatStrip
            items={[
              {
                label: 'Open incidents',
                value: d.openIncidents,
                hint: 'Not yet resolved',
              },
              {
                label: 'Critical (SEV1)',
                value: d.criticalIncidents,
                hint: 'Open SEV1 incidents',
                tone: d.criticalIncidents ? 'danger' : 'default',
              },
              {
                label: 'Degraded services',
                value: d.degradedServices.length,
                hint: 'Degraded or down',
                tone: d.degradedServices.length ? 'warning' : 'default',
              },
              {
                label: 'Avg. resolution',
                value: formatDuration(d.avgResolutionMinutes),
                hint: 'Start to resolved',
              },
            ]}
          />

          <div className="grid gap-6 lg:grid-cols-3">
            <Panel
              headingId="trend-h"
              title="Incidents"
              description={`${weekTotal} opened in the last 7 days`}
              className="lg:col-span-2"
              bodyClassName="p-5"
              action={
                <Link href="/incidents" className="text-sm text-ink-muted hover:text-ink">
                  View all
                </Link>
              }
            >
              {history.data ? (
                <AreaTrend
                  id="incidents-week"
                  data={week}
                  height={210}
                  summary={`Incidents per day over the last 7 days: ${week.map((p) => `${p.label} ${p.value}`).join(', ')}`}
                />
              ) : (
                <Skeleton className="h-[210px]" />
              )}
            </Panel>

            <Panel
              headingId="health-h"
              title="Service health"
              description={
                services.data ? `${healthy} of ${allServices.length} healthy` : 'Loading…'
              }
              action={
                <Link href="/services" className="text-sm text-ink-muted hover:text-ink">
                  All services
                </Link>
              }
            >
              {!services.data ? (
                <div className="p-5">
                  <Skeleton className="h-24" />
                </div>
              ) : allServices.length === 0 ? (
                <p className="p-5 text-sm text-ink-muted">No services yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {allServices.slice(0, 6).map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`/services/${s.id}`}
                        className="flex items-center justify-between gap-3 px-5 py-3 text-sm transition-colors hover:bg-surface-2"
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <StatusDot status={s.status} />
                          <span className="truncate font-medium">{s.name}</span>
                        </span>
                        <span className="shrink-0 text-xs text-ink-subtle">
                          {s.status.charAt(0) + s.status.slice(1).toLowerCase()}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel
              headingId="deploys-h"
              title="Recent deployments"
              description="Latest releases across services"
            >
              {d.recentDeployments.length === 0 ? (
                <p className="p-5 text-sm text-ink-muted">No deployments recorded.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {d.recentDeployments.map((dep) => (
                    <li key={dep.id} className="flex items-center gap-3 px-5 py-3.5 text-sm">
                      <span
                        aria-hidden="true"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-ink-muted"
                      >
                        <Rocket className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {dep.serviceName}{' '}
                          <span className="ml-1 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-ink-muted">
                            {dep.version}
                          </span>
                        </p>
                        <p className="truncate text-xs text-ink-subtle">
                          {dep.environment} · {dep.deployedBy}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-ink-subtle">
                        {timeAgo(dep.deployedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              headingId="activity-h"
              title="Recent activity"
              description="What your team did, as it happened"
            >
              {d.recentActivity.length === 0 ? (
                <p className="p-5 text-sm text-ink-muted">No activity yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {d.recentActivity.map((a) => {
                    const Icon = eventIcon(a.eventType);
                    return (
                      <li key={a.id} className="flex items-start gap-3 px-5 py-3.5 text-sm">
                        <span
                          aria-hidden="true"
                          className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-ink-muted"
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <p className="min-w-0 flex-1 leading-snug">
                          <span className="font-medium">{a.actorName}</span>{' '}
                          <span className="text-ink-muted">{activityVerb(a.eventType)}</span>{' '}
                          <Link href={`/incidents/${a.incidentId}`} className={linkClass}>
                            {a.incidentTitle}
                          </Link>
                        </p>
                        <span className="shrink-0 text-xs text-ink-subtle">
                          {timeAgo(a.createdAt)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
