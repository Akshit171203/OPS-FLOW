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
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useFetch } from '@/lib/useFetch';
import { buttonClass, ErrorText, secondaryButtonClass, ServiceStatusBadge } from './ui';

const levelStyle: Record<LogLevel, string> = {
  DEBUG: 'text-slate-500',
  INFO: 'text-slate-700',
  WARN: 'text-amber-700',
  ERROR: 'text-red-700 font-medium',
};

export function MetricsLine({ serviceId, refreshKey }: { serviceId: string; refreshKey: number }) {
  const { data } = useFetch<{ metric: MetricDto | null }>(
    `/api/services/${serviceId}/metrics/latest?k=${refreshKey}`,
  );
  const m = data?.metric;
  if (!m)
    return <p className="text-sm text-slate-500">No metrics recorded for this service yet.</p>;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
      <ServiceStatusBadge value={m.healthStatus} />
      <span>
        Error rate <strong>{(m.errorRate * 100).toFixed(1)}%</strong>
      </span>
      <span>
        Latency <strong>{m.latencyMs} ms</strong>
      </span>
      <span>
        Traffic <strong>{m.requestsPerMin}/min</strong>
      </span>
      <span className="text-xs text-slate-500">as of {formatDate(m.capturedAt)}</span>
    </div>
  );
}

export function LogsPanel({ incidentId, refreshKey }: { incidentId: string; refreshKey: number }) {
  const [level, setLevel] = useState<LogLevel | ''>('');
  const [items, setItems] = useState<LogDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const query = useCallback(
    (after?: string | null) => {
      const p = new URLSearchParams({ incidentId, limit: '25' });
      if (level) p.set('level', level);
      if (after) p.set('cursor', after);
      return api<CursorPage<LogDto>>(`/api/logs?${p}`);
    },
    [incidentId, level],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    query()
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setError(null);
      })
      .catch(
        (e) => !cancelled && setError(e instanceof ApiError ? e.message : 'Failed to load logs'),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query, refreshKey]);

  async function loadMore() {
    try {
      const page = await query(cursor);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load logs');
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-medium">Logs</h2>
        <select
          aria-label="Log level"
          value={level}
          onChange={(e) => setLevel(e.target.value as LogLevel | '')}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="">All levels</option>
          {logLevels.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
      </div>
      <ErrorText>{error}</ErrorText>
      {loading && items.length === 0 ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-500">
          No logs for this incident.
        </p>
      ) : (
        <div className="max-h-96 overflow-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-left font-mono text-xs">
            <tbody className="divide-y divide-slate-100">
              {items.map((l) => (
                <tr key={l.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-1.5 text-slate-500">
                    {new Date(l.timestamp).toLocaleTimeString()}
                  </td>
                  <td className={`px-2 py-1.5 ${levelStyle[l.level]}`}>{l.level}</td>
                  <td className="px-2 py-1.5 break-words">{l.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cursor && (
        <button className={`${secondaryButtonClass} mt-2`} onClick={loadMore}>
          Load more
        </button>
      )}
    </section>
  );
}

const deployStyle: Record<DeploymentDto['status'], string> = {
  SUCCESS: 'bg-green-50 text-green-700',
  FAILED: 'bg-red-50 text-red-700',
  ROLLED_BACK: 'bg-amber-50 text-amber-700',
  IN_PROGRESS: 'bg-blue-50 text-blue-700',
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
  const { data, error, reload } = useFetch<{ deployments: DeploymentDto[]; windowHours: number }>(
    `/api/incidents/${incidentId}/deployments?k=${refreshKey}`,
  );
  const [linkError, setLinkError] = useState<string | null>(null);

  async function link(deploymentId: string) {
    setLinkError(null);
    try {
      await api(`/api/incidents/${incidentId}/deployments`, {
        method: 'POST',
        json: { deploymentId },
      });
      reload();
      onLinked();
    } catch (e) {
      setLinkError(e instanceof ApiError ? e.message : 'Could not link deployment');
    }
  }

  return (
    <section>
      <h2 className="mb-2 font-medium">Recent deployments</h2>
      <ErrorText>{error ?? linkError}</ErrorText>
      {data?.deployments.length === 0 ? (
        <p className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-500">
          No deployments of this service in the last {data.windowHours} hours.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
          {data?.deployments.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">
                  {d.version}{' '}
                  <span className={`ml-1 rounded px-1.5 py-0.5 text-xs ${deployStyle[d.status]}`}>
                    {d.status}
                  </span>
                  {d.linked && (
                    <span className="ml-1 rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700">
                      linked
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {d.commitSha.slice(0, 7)} · {d.environment} · {d.deployedBy} ·{' '}
                  {formatDate(d.deployedAt)}
                </p>
              </div>
              {canLink && !d.linked && (
                <button className={buttonClass} onClick={() => link(d.id)}>
                  Link
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
