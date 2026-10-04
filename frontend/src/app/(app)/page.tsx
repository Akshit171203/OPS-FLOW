'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowUpRight, Flame, Rocket, Server, Timer } from 'lucide-react';
import {
  roleRank,
  type DashboardDto,
  type IncidentDto,
  type Paginated,
  type ServiceDto,
  type SimulateResult,
} from '@opsflow/shared';
import { Button, linkClass, secondaryButtonClass } from '@/components/ui';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingRegion,
  SectionHeading,
  Skeleton,
  StatCard,
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
      <Skeleton className="h-32" />
      <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
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

  return (
    <>
      <section
        aria-labelledby="hero-h"
        className="card-surface relative mb-6 overflow-hidden rounded-2xl p-6 sm:p-7"
      >
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full blur-3xl ${
            d && !allClear ? 'bg-dot-bad/20' : 'bg-accent-600/20'
          }`}
        />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 text-sm font-medium text-ink-muted">
              <StatusDot
                status={
                  !d ? 'UNKNOWN' : allClear ? 'HEALTHY' : d.criticalIncidents ? 'DOWN' : 'DEGRADED'
                }
              />
              {me.organization.name}
            </p>
            <h1 id="hero-h" className="mt-1.5 text-3xl font-semibold tracking-tight">
              {!d
                ? 'Dashboard'
                : allClear
                  ? 'All systems operational'
                  : `${d.openIncidents} open ${d.openIncidents === 1 ? 'incident needs' : 'incidents need'} attention`}
            </h1>
            <p className="mt-1.5 text-sm text-ink-muted">
              {d
                ? `${d.degradedServices.length} degraded or down · ${weekTotal} incident${weekTotal === 1 ? '' : 's'} in the last 7 days`
                : 'Loading the latest picture…'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && (
              <Button
                variant="secondary"
                onClick={simulate}
                loading={simulating}
                loadingText="Simulating…"
              >
                <Flame className="h-4 w-4" aria-hidden="true" />
                Simulate payment outage
              </Button>
            )}
            <Link href="/incidents" className={secondaryButtonClass}>
              All incidents
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

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
                Simulate payment outage
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard
              label="Open incidents"
              value={d.openIncidents}
              hint="Not yet resolved"
              icon={<AlertTriangle className="h-4 w-4" />}
              tone={d.openIncidents ? 'warning' : 'good'}
            />
            <StatCard
              label="Critical (SEV1)"
              value={d.criticalIncidents}
              tone={d.criticalIncidents ? 'danger' : 'default'}
              hint="Open SEV1 incidents"
              icon={<Flame className="h-4 w-4" />}
            />
            <StatCard
              label="Degraded services"
              value={d.degradedServices.length}
              tone={d.degradedServices.length ? 'warning' : 'good'}
              hint="Degraded or down"
              icon={<Server className="h-4 w-4" />}
            />
            <StatCard
              label="Avg. resolution"
              value={formatDuration(d.avgResolutionMinutes)}
              hint="Start to resolved"
              icon={<Timer className="h-4 w-4" />}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <section aria-labelledby="trend-h" className="min-w-0 lg:col-span-3">
              <SectionHeading>
                <span id="trend-h">Incidents · last 7 days</span>
              </SectionHeading>
              <Card className="p-4">
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
              </Card>
            </section>

            <section aria-labelledby="health-h" className="min-w-0 lg:col-span-2">
              <SectionHeading>
                <span id="health-h">Service health</span>
              </SectionHeading>
              <Card className="divide-y divide-line">
                {!services.data ? (
                  <div className="p-4">
                    <Skeleton className="h-24" />
                  </div>
                ) : services.data.items.length === 0 ? (
                  <p className="p-4 text-sm text-ink-muted">No services yet.</p>
                ) : (
                  services.data.items.slice(0, 6).map((s) => (
                    <Link
                      key={s.id}
                      href={`/services/${s.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-surface-2"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <StatusDot status={s.status} />
                        <span className="truncate font-medium">{s.name}</span>
                      </span>
                      <span className="shrink-0 text-xs uppercase tracking-wide text-ink-subtle">
                        {s.status}
                      </span>
                    </Link>
                  ))
                )}
              </Card>
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="deploys-h" className="min-w-0">
              <SectionHeading>
                <span id="deploys-h">Recent deployments</span>
              </SectionHeading>
              <Card>
                {d.recentDeployments.length === 0 ? (
                  <p className="p-4 text-sm text-ink-muted">No deployments recorded.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {d.recentDeployments.map((dep) => (
                      <li key={dep.id} className="flex items-center gap-3 p-3.5 text-sm">
                        <span
                          aria-hidden="true"
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-muted"
                        >
                          <Rocket className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">
                            {dep.serviceName}{' '}
                            <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-ink-muted">
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
              </Card>
            </section>

            <section aria-labelledby="activity-h" className="min-w-0">
              <SectionHeading>
                <span id="activity-h">Recent activity</span>
              </SectionHeading>
              <Card>
                {d.recentActivity.length === 0 ? (
                  <p className="p-4 text-sm text-ink-muted">No activity yet.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {d.recentActivity.map((a) => {
                      const Icon = eventIcon(a.eventType);
                      return (
                        <li key={a.id} className="flex items-start gap-3 p-3.5 text-sm">
                          <span
                            aria-hidden="true"
                            className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-ink"
                          >
                            <Icon className="h-3.5 w-3.5" />
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
              </Card>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
