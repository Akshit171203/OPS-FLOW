'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  roleRank,
  type IncidentDetailResponse,
  type IncidentEventDto,
  type IncidentStatus,
  type MemberDto,
} from '@opsflow/shared';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useIncidentRoom, useReconnect, useSocketEvent } from '@/lib/socket';
import { useFetch } from '@/lib/useFetch';
import { AiAnalysisPanel } from '@/components/AiAnalysisPanel';
import { DeploymentsPanel, LogsPanel, MetricsLine } from '@/components/IncidentPanels';
import { useMe } from '@/lib/me-context';
import {
  buttonClass,
  ErrorText,
  inputClass,
  PriorityBadge,
  secondaryButtonClass,
  SeverityBadge,
  StatusBadge,
} from '@/components/ui';

function describeEvent(e: IncidentEventDto, nameOf: (id: unknown) => string): string {
  const m = e.metadata as Record<string, unknown> & {
    from?: unknown;
    to?: unknown;
    changes?: Record<string, { from: unknown; to: unknown }>;
  };
  switch (e.eventType) {
    case 'incident.created':
      return 'created the incident';
    case 'incident.status_changed':
      return `moved status ${String(m.from)} → ${String(m.to)}`;
    case 'incident.assigned':
      return m.to ? `assigned the incident to ${nameOf(m.to)}` : 'removed the assignee';
    case 'incident.comment_added':
      return 'added a comment';
    case 'incident.deployment_linked':
      return `linked deployment ${String(e.metadata.version)} to this incident`;
    case 'incident.updated': {
      const parts = Object.entries(m.changes ?? {}).map(
        ([field, c]) => `${field} ${String(c.from ?? '—')} → ${String(c.to ?? '—')}`,
      );
      return `updated ${parts.join(', ') || 'details'}`;
    }
    case 'ai.analysis.requested':
      return 'requested an AI analysis';
    case 'ai.analysis.started':
      return 'AI analysis started';
    case 'ai.analysis.completed':
      return 'AI analysis completed';
    case 'ai.analysis.failed':
      return `AI analysis failed (${String(e.metadata.code)})`;
    default:
      return e.eventType;
  }
}

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const canWrite = roleRank[me.role] >= roleRank.ENGINEER;
  const detail = useFetch<IncidentDetailResponse>(`/api/incidents/${id}`);
  const members = useFetch<{ members: MemberDto[] }>('/api/members');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  // Live updates: any change to this incident (by anyone) refreshes the page without a reload.
  useIncidentRoom(id);
  const refresh = () => {
    detail.reload();
    setRefreshKey((k) => k + 1);
  };
  const onLive = (d: { incidentId: string }) => d.incidentId === id && refresh();
  useSocketEvent<{ incidentId: string }>('incident.updated', onLive);
  useSocketEvent<{ incidentId: string }>('incident.status_changed', onLive);
  useSocketEvent<{ incidentId: string }>('incident.comment_added', onLive);
  useSocketEvent<{ incidentId: string }>('ai.analysis_completed', onLive); // timeline entries for AI runs
  useSocketEvent<{ incidentId: string }>('ai.analysis_failed', onLive);
  useReconnect(refresh);

  if (detail.error && !detail.data) return <ErrorText>{detail.error}</ErrorText>;
  if (!detail.data) return <p className="text-slate-500">Loading…</p>;
  const { incident, events, comments } = detail.data;
  const nameOf = (userId: unknown) =>
    members.data?.members.find((m) => m.userId === userId)?.name ?? 'someone';

  async function mutate(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
      detail.reload(); // always refetch: on a version conflict this shows the newer state
    }
  }

  const changeStatus = (status: IncidentStatus) =>
    mutate(() =>
      api(`/api/incidents/${id}/status`, {
        method: 'PATCH',
        json: { version: incident.version, status },
      }),
    );
  const assign = (assigneeId: string) =>
    mutate(() =>
      api(`/api/incidents/${id}/assignee`, {
        method: 'PATCH',
        json: { version: incident.version, assigneeId: assigneeId || null },
      }),
    );
  const addComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return;
    mutate(async () => {
      await api(`/api/incidents/${id}/comments`, { method: 'POST', json: { body: comment } });
      setComment('');
    });
  };

  return (
    <article className="space-y-6">
      <Link href="/incidents" className="text-sm text-indigo-700 underline">
        ← All incidents
      </Link>

      <header className="rounded border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{incident.title}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {incident.serviceName} · started {formatDate(incident.startedAt)}
              {incident.resolvedAt && ` · resolved ${formatDate(incident.resolvedAt)}`}
            </p>
          </div>
          <div className="flex gap-2">
            <SeverityBadge value={incident.severity} />
            <PriorityBadge value={incident.priority} />
            <StatusBadge value={incident.status} />
          </div>
        </div>
        {incident.description && (
          <p className="mt-3 whitespace-pre-wrap text-sm">{incident.description}</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Assignee</span>
            {canWrite ? (
              <select
                aria-label="Assignee"
                value={incident.assignee?.id ?? ''}
                disabled={busy}
                onChange={(e) => assign(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              >
                <option value="">Unassigned</option>
                {members.data?.members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <span>{incident.assignee?.name ?? 'Unassigned'}</span>
            )}
          </div>
          {canWrite && incident.allowedNextStatuses.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">Move to</span>
              {incident.allowedNextStatuses.map((s) => (
                <button
                  key={s}
                  className={secondaryButtonClass}
                  disabled={busy}
                  onClick={() => changeStatus(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mt-3">
          <ErrorText>{error}</ErrorText>
        </div>
        <div className="mt-4 border-t border-slate-100 pt-3">
          <MetricsLine serviceId={incident.serviceId} refreshKey={refreshKey} />
        </div>
      </header>

      <AiAnalysisPanel incidentId={id} canRun={canWrite} />

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 font-medium">Comments</h2>
          <ul className="space-y-3">
            {comments.length === 0 && <li className="text-sm text-slate-500">No comments yet.</li>}
            {comments.map((c) => (
              <li key={c.id} className="rounded border border-slate-200 bg-white p-3 text-sm">
                <p className="whitespace-pre-wrap">{c.body}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {c.author.name} · {formatDate(c.createdAt)}
                </p>
              </li>
            ))}
          </ul>
          {canWrite && (
            <form onSubmit={addComment} className="mt-3 space-y-2">
              <textarea
                aria-label="New comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                maxLength={5000}
                className={inputClass}
              />
              <button className={buttonClass} disabled={busy || !comment.trim()}>
                Add comment
              </button>
            </form>
          )}
        </section>

        <section>
          <h2 className="mb-2 font-medium">Timeline</h2>
          <ol className="space-y-3 border-l-2 border-slate-200 pl-4">
            {events.map((e) => (
              <li key={e.id} className="text-sm">
                <p>
                  <strong>{e.actor.name}</strong> {describeEvent(e, nameOf)}
                </p>
                <p className="text-xs text-slate-500">{formatDate(e.createdAt)}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <LogsPanel incidentId={id} refreshKey={refreshKey} />
        <DeploymentsPanel
          incidentId={id}
          canLink={canWrite}
          refreshKey={refreshKey}
          onLinked={detail.reload}
        />
      </div>
    </article>
  );
}
