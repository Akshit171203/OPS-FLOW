'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  logLevels,
  type CursorPage,
  type DeploymentDto,
  type LogDto,
  type LogLevel,
  type MetricDto,
} from '@opsflow/shared';
import { api } from '@/lib/api';
import { formatDate, percent } from '@/lib/format';
import { useFetch } from '@/lib/useFetch';
import { Card, EmptyState, ErrorState, Skeleton } from './feedback';
import { useToast, messageOf } from './toast';
import { Button, Pill, ServiceStatusBadge, secondaryButtonClass } from './ui';

export function MetricsLine({ serviceId, refreshKey }: { serviceId: string; refreshKey: number }) {
  const { data, loading } = useFetch<{ metric: MetricDto | null }>(
    `/api/services/${serviceId}/metrics/latest?k=${refreshKey}`,
  );
  const m = data?.metric;
  if (loading && !data) return <Skeleton className="h-6 w-full max-w-md" />;
  if (!m)
    return <p className="text-sm text-ink-muted">No metrics recorded for this service yet.</p>;
  return (
    <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
      <div className="flex items-center gap-2">
        <dt className="sr-only">Health</dt>
        <dd>
          <ServiceStatusBadge value={m.healthStatus} />
        </dd>
      </div>
      <div>
        <dt className="inline text-ink-muted">Error rate </dt>
        <dd className="inline font-semibold">{percent(m.errorRate)}</dd>
      </div>
      <div>
        <dt className="inline text-ink-muted">Latency </dt>
        <dd className="inline font-semibold">{m.latencyMs} ms</dd>
      </div>
      <div>
        <dt className="inline text-ink-muted">Traffic </dt>
        <dd className="inline font-semibold">{m.requestsPerMin}/min</dd>
      </div>
      <div className="text-xs text-ink-subtle">as of {formatDate(m.capturedAt)}</div>
    </dl>
  );
}

const levelStyle: Record<LogLevel, string> = {
  DEBUG: 'bg-closed-bg text-closed-fg',
  INFO: 'bg-mitigating-bg text-mitigating-fg',
  WARN: 'bg-degraded-bg text-degraded-fg',
  ERROR: 'bg-down-bg text-down-fg',
};

export function LogsPanel({ incidentId, refreshKey }: { incidentId: string; refreshKey: number }) {
  const [level, setLevel] = useState<LogLevel | ''>('');
  const [items, setItems] = useState<LogDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const toast = useToast();

  const query = useCallback(
    (after?: string | null) => {
      const p = new URLSearchParams({ incidentId, limit: '25' });
      if (level) p.set('level', level);
      if (after) p.set('cursor', after);
      return api<CursorPage<LogDto>>(`/api/logs?${p}`);
    },
    [incidentId, level],
  );

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    query()
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setError(null);
      })
      .catch((e) => !cancelled && setError(messageOf(e, 'Could not load logs.')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query]);
  useEffect(() => load(), [load, refreshKey]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const page = await query(cursor);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      toast.error(e, 'Could not load more logs.');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section aria-labelledby="logs-h">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="logs-h" className="text-base font-semibold">
          Logs
        </h2>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-muted">Level</span>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as LogLevel | '')}
            className="rounded-md border border-slate-300 bg-surface px-2 py-1.5 text-sm"
          >
            <option value="">All</option>
            {logLevels.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
      </div>
      {error && !items.length ? (
        <ErrorState message={error} onRetry={() => load()} />
      ) : loading && items.length === 0 ? (
        <div role="status" aria-busy="true" className="space-y-2">
          <span className="sr-only">Loading logs…</span>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-7" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={level ? `No ${level} logs for this incident` : 'No logs linked to this incident'}
          description="Logs sent with this incident's id show up here."
        />
      ) : (
        <Card className="max-h-96 overflow-auto">
          <table className="w-full min-w-[32rem] text-left font-mono text-xs">
            <thead className="sticky top-0 bg-surface text-[11px] uppercase tracking-wide text-ink-muted shadow-[0_1px_0_var(--color-line)]">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Time
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Level
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Message
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((l) => (
                <tr key={l.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-1.5 text-ink-subtle">
                    {new Date(l.timestamp).toLocaleTimeString()}
                  </td>
                  <td className="px-2 py-1.5">
                    <Pill className={levelStyle[l.level]}>{l.level}</Pill>
                  </td>
                  <td className="break-words px-2 py-1.5 text-ink">{l.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {cursor && (
        <Button
          variant="secondary"
          className="mt-2"
          onClick={loadMore}
          loading={loadingMore}
          loadingText="Loading…"
        >
          Load more
        </Button>
      )}
    </section>
  );
}

const deployStyle: Record<DeploymentDto['status'], string> = {
  SUCCESS: 'bg-resolved-bg text-resolved-fg',
  FAILED: 'bg-down-bg text-down-fg',
  ROLLED_BACK: 'bg-degraded-bg text-degraded-fg',
  IN_PROGRESS: 'bg-mitigating-bg text-mitigating-fg',
};

export function DeploymentsPanel({
  incidentId,
  canLink,
  refreshKey,
  onLinked,
}: {
  incidentId: string;
  canLink: boolean;
  refreshKey: number;
  onLinked: () => void;
}) {
  const toast = useToast();
  const { data, error, loading, reload } = useFetch<{
    deployments: DeploymentDto[];
    windowHours: number;
  }>(`/api/incidents/${incidentId}/deployments?k=${refreshKey}`);
  const [linking, setLinking] = useState<string | null>(null);

  async function link(d: DeploymentDto) {
    setLinking(d.id);
    try {
      await api(`/api/incidents/${incidentId}/deployments`, {
        method: 'POST',
        json: { deploymentId: d.id },
      });
      toast.success(`Linked ${d.version} to this incident.`);
      reload();
      onLinked();
    } catch (e) {
      toast.error(e, 'Could not link the deployment.');
    } finally {
      setLinking(null);
    }
  }

  return (
    <section aria-labelledby="deps-h">
      <h2 id="deps-h" className="mb-3 text-base font-semibold">
        Recent deployments
      </h2>
      {error && !data ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading && !data ? (
        <div role="status" aria-busy="true">
          <span className="sr-only">Loading deployments…</span>
          <Skeleton className="h-20" />
        </div>
      ) : data?.deployments.length === 0 ? (
        <EmptyState
          title="No recent deployments"
          description={`Nothing was deployed to this service in the ${data.windowHours} hours before the incident.`}
        />
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {data?.deployments.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 font-medium">
                    <span className="font-mono">{d.version}</span>
                    <Pill className={deployStyle[d.status]}>{d.status}</Pill>
                    {d.linked && <Pill className="bg-accent-100 text-accent-800">Linked</Pill>}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ink-subtle">
                    {d.commitSha.slice(0, 7)} · {d.environment} · {d.deployedBy} ·{' '}
                    {formatDate(d.deployedAt)}
                  </p>
                </div>
                {canLink && !d.linked && (
                  <button
                    className={secondaryButtonClass}
                    onClick={() => link(d)}
                    disabled={linking === d.id}
                    aria-label={`Link deployment ${d.version} to this incident`}
                  >
                    {linking === d.id ? 'Linking…' : 'Link'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
