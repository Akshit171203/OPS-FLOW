'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
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
import { linkClass, ServiceStatusBadge, SeverityBadge, StatusBadge } from '@/components/ui';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingRegion,
  PageHeader,
  SectionHeading,
  Skeleton,
} from '@/components/feedback';
import { Sparkline } from '@/components/Sparkline';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { formatDate, percent, timeAgo } from '@/lib/format';
import { useMe } from '@/lib/me-context';
import { useFetch } from '@/lib/useFetch';
import { usePageTitle } from '@/lib/usePageTitle';

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </Card>
  );
}

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
      <p className="mb-2 text-sm">
        <Link href="/services" className={linkClass}>
          ← Services
        </Link>
      </p>
      <PageHeader
        title={s.name}
        description={`${s.projectName} · ${s.slug}`}
        actions={
          isAdmin ? (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-ink-muted">Status</span>
              <select
                value={s.status}
                onChange={(e) => setStatus(e.target.value as ServiceStatus)}
                className="rounded-md border border-slate-300 bg-surface px-2 py-1.5 text-sm"
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
        <Tile label="Error rate" value={m ? percent(m.errorRate) : '—'} />
        <Tile label="Latency" value={m ? `${m.latencyMs} ms` : '—'} />
        <Tile label="Traffic" value={m ? `${m.requestsPerMin}/min` : '—'} />
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
              <p className="mb-2 text-sm font-medium">Error rate</p>
              <Sparkline
                label="Error rate over 24 hours"
                points={pts.map((p) => ({ t: Date.parse(p.capturedAt), v: p.errorRate }))}
                format={percent}
                stroke="var(--color-sev1-fg)"
              />
            </Card>
            <Card className="p-4">
              <p className="mb-2 text-sm font-medium">Latency</p>
              <Sparkline
                label="Latency over 24 hours"
                points={pts.map((p) => ({ t: Date.parse(p.capturedAt), v: p.latencyMs }))}
                format={(v) => `${Math.round(v)} ms`}
              />
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
                      className="flex items-center justify-between gap-3 p-3 hover:bg-slate-50"
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
