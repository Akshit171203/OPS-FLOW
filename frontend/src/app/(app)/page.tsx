'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { roleRank, type DashboardDto, type SimulateResult } from '@opsflow/shared';
import { Button, linkClass, secondaryButtonClass, ServiceStatusBadge } from '@/components/ui';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingRegion,
  PageHeader,
  SectionHeading,
  Skeleton,
  StatCard,
} from '@/components/feedback';
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
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    </LoadingRegion>
  );
}

export default function DashboardPage() {
  usePageTitle('Dashboard');
  const me = useMe();
  const router = useRouter();
  const toast = useToast();
  const isAdmin = roleRank[me.role] >= roleRank.ADMIN;
  const dash = useFetch<DashboardDto>('/api/dashboard');
  const [simulating, setSimulating] = useState(false);

  // The dashboard follows the organization live: any incident change refreshes it
  useSocketEvent('incident.created', dash.reload);
  useSocketEvent('incident.updated', dash.reload);
  useSocketEvent('incident.status_changed', dash.reload);
  useReconnect(dash.reload);

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
  const quiet =
    d && d.openIncidents === 0 && d.recentActivity.length === 0 && d.recentDeployments.length === 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${me.organization.name} · live`}
        actions={
          <>
            {isAdmin && (
              <Button
                variant="secondary"
                onClick={simulate}
                loading={simulating}
                loadingText="Simulating…"
              >
                Simulate payment outage
              </Button>
            )}
            <Link href="/incidents" className={secondaryButtonClass}>
              All incidents
            </Link>
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
          description="No incidents, deployments or activity so far. Create a service and open an incident, or simulate an outage to see the whole flow."
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
            <StatCard label="Open incidents" value={d.openIncidents} hint="Not yet resolved" />
            <StatCard
              label="Critical (SEV1)"
              value={d.criticalIncidents}
              tone={d.criticalIncidents ? 'danger' : 'default'}
              hint="Open SEV1 incidents"
            />
            <StatCard
              label="Degraded services"
              value={d.degradedServices.length}
              tone={d.degradedServices.length ? 'warning' : 'default'}
              hint="Degraded or down"
            />
            <StatCard
              label="Avg. resolution"
              value={formatDuration(d.avgResolutionMinutes)}
              hint="Start to resolved"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="degraded-h" className="min-w-0">
              <SectionHeading>
                <span id="degraded-h">Services needing attention</span>
              </SectionHeading>
              <Card>
                {d.degradedServices.length === 0 ? (
                  <p className="p-4 text-sm text-ink-muted">All services are healthy.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {d.degradedServices.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-3 p-3">
                        <Link href={`/services/${s.id}`} className={`${linkClass} font-medium`}>
                          {s.name}
                        </Link>
                        <ServiceStatusBadge value={s.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>

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
                      <li
                        key={dep.id}
                        className="flex items-center justify-between gap-3 p-3 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {dep.serviceName}{' '}
                            <span className="font-mono text-xs text-ink-muted">{dep.version}</span>
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
          </div>

          <section aria-labelledby="activity-h">
            <SectionHeading>
              <span id="activity-h">Recent activity</span>
            </SectionHeading>
            <Card>
              {d.recentActivity.length === 0 ? (
                <p className="p-4 text-sm text-ink-muted">No activity yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {d.recentActivity.map((a) => (
                    <li key={a.id} className="flex items-start justify-between gap-3 p-3 text-sm">
                      <p className="min-w-0">
                        <span className="font-medium">{a.actorName}</span>{' '}
                        {activityVerb(a.eventType)}{' '}
                        <Link href={`/incidents/${a.incidentId}`} className={linkClass}>
                          {a.incidentTitle}
                        </Link>
                      </p>
                      <span className="shrink-0 text-xs text-ink-subtle">
                        {timeAgo(a.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </div>
      )}
    </>
  );
}
