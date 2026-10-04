'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Activity, ArrowLeft, Gauge, Timer } from 'lucide-react';
import {
  roleRank,
  serviceStatuses,
  type DeploymentDto,
  type IncidentDto,
  type MetricDto,
  type MetricSeriesDto,
  type Paginated,
  type ServiceDto,
  type ServiceStatus,
} from '@opsflow/shared';
import { ServiceStatusBadge, SeverityBadge, StatusBadge } from '@/components/ui';
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
import { AreaTrend } from '@/components/charts';
import { StatusDot } from '@/components/StatusDot';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { formatDate, percent, timeAgo } from '@/lib/format';
import { useMe } from '@/lib/me-context';
import { useFetch } from '@/lib/useFetch';
import { usePageTitle } from '@/lib/usePageTitle';

const hourLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export default function ServiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const toast = useToast();
  const isAdmin = roleRank[me.role] >= roleRank.ADMIN;
  const service = useFetch<{ service: ServiceDto }>(`/api/services/${id}`);
  const latest = useFetch<{ metric: MetricDto | null }>(`/api/services/${id}/metrics/latest`);
  const series = useFetch<MetricSeriesDto>(`/api/services/${id}/metrics?hours=24`);
  const deployments = useFetch<Paginated<DeploymentDto>>(
    `/api/deployments?serviceId=${id}&limit=5`,
  );
  const incidents = useFetch<Paginated<IncidentDto>>(`/api/incidents?serviceId=${id}&limit=5`);
  const name = service.data?.service.name ?? 'Service';
  usePageTitle(name);

  async function setStatus(status: ServiceStatus) {
    try {
      await api(`/api/services/${id}`, { method: 'PATCH', json: { status } });
      toast.success(`Status set to ${status}.`);
      service.reload();
    } catch (e) {
      toast.error(e);
    }
  }

  if (service.error && !service.data)
    return <ErrorState message={service.error} onRetry={service.reload} />;
  if (!service.data) {
    return (
      <LoadingRegion label="Loading service">
        <Skeleton className="mb-6 h-9 w-64" />
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      </LoadingRegion>
    );
  }

  const s = service.data.service;
  const m = latest.data?.metric;
  const pts = series.data?.points ?? [];

  return (
    <>
      <p className="mb-3 text-sm">
        <Link
          href="/services"
          className="inline-flex items-center gap-1.5 text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Services
        </Link>
      </p>
      <PageHeader
        title={s.name}
        description={
          <span className="inline-flex items-center gap-2">
            <StatusDot status={s.status} />
            {s.projectName} · <span className="font-mono text-xs">{s.slug}</span>
          </span>
        }
        actions={
          isAdmin ? (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-ink-muted">Status</span>
              <select
                value={s.status}
                onChange={(e) => setStatus(e.target.value as ServiceStatus)}
                className="rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-sm transition focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/25"
              >
                {serviceStatuses.map((st) => (
                  <option key={st}>{st}</option>
                ))}
              </select>
            </label>
          ) : (
            <ServiceStatusBadge value={s.status} />
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Error rate"
          value={m ? percent(m.errorRate) : '—'}
          icon={<Activity className="h-4 w-4" />}
          tone={m && m.errorRate > 0.05 ? 'danger' : 'default'}
        />
        <StatCard
          label="Latency"
          value={m ? `${m.latencyMs} ms` : '—'}
          icon={<Timer className="h-4 w-4" />}
          tone={m && m.latencyMs > 1000 ? 'warning' : 'default'}
        />
        <StatCard
          label="Traffic"
          value={m ? `${m.requestsPerMin}/min` : '—'}
          icon={<Gauge className="h-4 w-4" />}
        />
      </div>
      <p className="mt-2 text-xs text-ink-subtle">
        {m
          ? `Latest snapshot ${timeAgo(m.capturedAt)}`
          : 'No metrics recorded for this service yet.'}
      </p>

      <section aria-labelledby="trend-h" className="mt-8">
        <SectionHeading>
          <span id="trend-h">Last 24 hours</span>
        </SectionHeading>
        {series.error && !series.data ? (
          <ErrorState message={series.error} onRetry={series.reload} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="p-4">
              <p className="mb-3 text-sm font-medium">Error rate</p>
              {pts.length < 2 ? (
                <p className="text-sm text-ink-subtle">Not enough data to draw this yet.</p>
              ) : (
                <AreaTrend
                  id="error-rate"
                  data={pts.map((p) => ({
                    label: hourLabel(p.capturedAt),
                    value: p.errorRate * 100,
                  }))}
                  unit="%"
                  decimals={1}
                  color="var(--color-sev1-fg)"
                  summary={`Error rate over the last 24 hours, latest ${percent(pts[pts.length - 1]!.errorRate)}`}
                />
              )}
            </Card>
            <Card className="p-4">
              <p className="mb-3 text-sm font-medium">Latency</p>
              {pts.length < 2 ? (
                <p className="text-sm text-ink-subtle">Not enough data to draw this yet.</p>
              ) : (
                <AreaTrend
                  id="latency"
                  data={pts.map((p) => ({ label: hourLabel(p.capturedAt), value: p.latencyMs }))}
                  unit=" ms"
                  summary={`Latency over the last 24 hours, latest ${Math.round(pts[pts.length - 1]!.latencyMs)} ms`}
                />
              )}
            </Card>
          </div>
        )}
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="dep-h" className="min-w-0">
          <SectionHeading>
            <span id="dep-h">Recent deployments</span>
          </SectionHeading>
          {deployments.error && !deployments.data ? (
            <ErrorState message={deployments.error} onRetry={deployments.reload} />
          ) : deployments.data?.items.length === 0 ? (
            <EmptyState title="No deployments recorded" />
          ) : (
            <Card>
              <ul className="divide-y divide-line">
                {(deployments.data?.items ?? []).map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">
                        <span className="font-mono">{d.version}</span>{' '}
                        <span className="text-xs font-normal text-ink-muted">{d.status}</span>
                      </p>
                      <p className="truncate text-xs text-ink-subtle">
                        {d.commitSha.slice(0, 7)} · {d.environment} · {d.deployedBy}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-ink-subtle">
                      {formatDate(d.deployedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>

        <section aria-labelledby="inc-h" className="min-w-0">
          <SectionHeading>
            <span id="inc-h">Recent incidents</span>
          </SectionHeading>
          {incidents.error && !incidents.data ? (
            <ErrorState message={incidents.error} onRetry={incidents.reload} />
          ) : incidents.data?.items.length === 0 ? (
            <EmptyState title="No incidents for this service" description="That is a good sign." />
          ) : (
            <Card>
              <ul className="divide-y divide-line">
                {(incidents.data?.items ?? []).map((i) => (
                  <li key={i.id}>
                    <Link
                      href={`/incidents/${i.id}`}
                      className="flex items-center justify-between gap-3 p-3 hover:bg-surface-2"
                    >
                      <span className="min-w-0 truncate text-sm font-medium">{i.title}</span>
                      <span className="flex shrink-0 gap-1.5">
                        <SeverityBadge value={i.severity} />
                        <StatusBadge value={i.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      </div>
    </>
  );
}
