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
import { AiAnalysisPanel } from '@/components/AiAnalysisPanel';
import {
  Card,
  ErrorState,
  LoadingRegion,
  SectionHeading,
  Skeleton,
  SkeletonLines,
} from '@/components/feedback';
import { DeploymentsPanel, LogsPanel, MetricsLine } from '@/components/IncidentPanels';
import { useToast } from '@/components/toast';
import {
  Button,
  inputClass,
  Pill,
  linkClass,
  PriorityBadge,
  secondaryButtonClass,
  SeverityBadge,
  StatusBadge,
} from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/format';
import { useMe } from '@/lib/me-context';
import { useIncidentRoom, useReconnect, useSocketEvent } from '@/lib/socket';
import { useFetch } from '@/lib/useFetch';
import { usePageTitle } from '@/lib/usePageTitle';

function describeEvent(e: IncidentEventDto, nameOf: (id: unknown) => string): string {
  const m = e.metadata as Record<string, unknown> & {
    from?: unknown;
    to?: unknown;
    changes?: Record<string, { from: unknown; to: unknown }>;
  };
  switch (e.eventType) {
    case 'incident.created':
      return 'opened the incident';
    case 'incident.status_changed':
      return `moved status ${String(m.from)} → ${String(m.to)}`;
    case 'incident.assigned':
      return m.to ? `assigned the incident to ${nameOf(m.to)}` : 'removed the assignee';
    case 'incident.comment_added':
      return 'added a comment';
    case 'incident.deployment_linked':
      return `linked deployment ${String(e.metadata.version)} to this incident`;
    case 'incident.alert_repeated':
      return 'reported the alert firing again';
    case 'incident.alert_resolved':
      return 'reported the alert resolved (the incident stays open until someone closes it)';
    case 'ai.analysis.requested':
      return 'requested an AI analysis';
    case 'ai.analysis.started':
      return 'AI analysis started';
    case 'ai.analysis.completed':
      return 'AI analysis completed';
    case 'ai.analysis.failed':
      return `AI analysis failed (${String(e.metadata.code)})`;
    case 'incident.updated': {
      const parts = Object.entries(m.changes ?? {}).map(
        ([field, c]) => `${field} ${String(c.from ?? '—')} → ${String(c.to ?? '—')}`,
      );
      return `updated ${parts.join(', ') || 'details'}`;
    }
    default:
      return e.eventType;
  }
}

function DetailSkeleton() {
  return (
    <LoadingRegion label="Loading incident">
      <Skeleton className="mb-3 h-5 w-24" />
      <Card className="mb-6 p-4">
        <Skeleton className="mb-3 h-8 w-2/3" />
        <SkeletonLines lines={2} />
      </Card>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-40" />
        </div>
        <Skeleton className="h-72" />
      </div>
    </LoadingRegion>
  );
}

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const toast = useToast();
  const canWrite = roleRank[me.role] >= roleRank.ENGINEER;
  const detail = useFetch<IncidentDetailResponse>(`/api/incidents/${id}`);
  const members = useFetch<{ members: MemberDto[] }>('/api/members');
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  usePageTitle(detail.data?.incident.title ?? 'Incident');

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

  if (detail.error && !detail.data)
    return <ErrorState message={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return <DetailSkeleton />;
  const { incident, events, comments } = detail.data;
  const nameOf = (userId: unknown) =>
    members.data?.members.find((m) => m.userId === userId)?.name ?? 'someone';

  async function mutate(success: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      toast.success(success);
    } catch (e) {
      toast.error(e); // for example "changed by someone else": the refetch below shows the newer state
    } finally {
      setBusy(false);
      detail.reload();
    }
  }

  const changeStatus = (status: IncidentStatus) =>
    mutate(`Moved to ${status}.`, () =>
      api(`/api/incidents/${id}/status`, {
        method: 'PATCH',
        json: { version: incident.version, status },
      }),
    );
  const assign = (assigneeId: string) =>
    mutate(assigneeId ? 'Assignee updated.' : 'Assignee removed.', () =>
      api(`/api/incidents/${id}/assignee`, {
        method: 'PATCH',
        json: { version: incident.version, assigneeId: assigneeId || null },
      }),
    );
  const addComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return;
    mutate('Comment added.', async () => {
      await api(`/api/incidents/${id}/comments`, { method: 'POST', json: { body: comment } });
      setComment('');
    });
  };

  return (
    <article>
      <p className="mb-2 text-sm">
        <Link href="/incidents" className={linkClass}>
          ← Incidents
        </Link>
      </p>

      {/* The header stays in view on wide screens so status and actions are always at hand */}
      <header className="z-10 mb-6 rounded-lg border border-line bg-surface p-4 shadow-sm lg:sticky lg:top-16">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{incident.title}</h1>
            <p className="mt-1 text-sm text-ink-muted">
              <Link href={`/services/${incident.serviceId}`} className={linkClass}>
                {incident.serviceName}
              </Link>{' '}
              · started {formatDate(incident.startedAt)}
              {incident.resolvedAt && ` · resolved ${formatDate(incident.resolvedAt)}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <SeverityBadge value={incident.severity} />
            <PriorityBadge value={incident.priority} />
            <StatusBadge value={incident.status} />
            {incident.source !== 'manual' && (
              <Pill className="bg-accent-100 text-accent-800">Alert · {incident.source}</Pill>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">Assignee</span>
            {canWrite ? (
              <select
                value={incident.assignee?.id ?? ''}
                disabled={busy}
                onChange={(e) => assign(e.target.value)}
                className="rounded-md border border-slate-300 bg-surface px-2 py-1.5 text-sm"
              >
                <option value="">Unassigned</option>
                {members.data?.members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="font-medium">{incident.assignee?.name ?? 'Unassigned'}</span>
            )}
          </label>
          {canWrite && incident.allowedNextStatuses.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-2 text-sm"
              role="group"
              aria-label="Change status"
            >
              <span className="text-ink-muted">Move to</span>
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
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {incident.description && (
            <Card className="p-4">
              <h2 className="mb-1 text-sm font-semibold text-ink-muted">Description</h2>
              <p className="whitespace-pre-wrap text-sm">{incident.description}</p>
            </Card>
          )}
          <Card className="p-4">
            <h2 className="mb-2 text-sm font-semibold text-ink-muted">Service health</h2>
            <MetricsLine serviceId={incident.serviceId} refreshKey={refreshKey} />
          </Card>
          <AiAnalysisPanel incidentId={id} canRun={canWrite} />
          <LogsPanel
            serviceId={incident.serviceId}
            startedAt={incident.startedAt}
            resolvedAt={incident.resolvedAt}
            refreshKey={refreshKey}
          />
          <DeploymentsPanel
            incidentId={id}
            canLink={canWrite}
            refreshKey={refreshKey}
            onLinked={detail.reload}
          />
        </div>

        <aside className="min-w-0 space-y-6" aria-label="Activity">
          <section aria-labelledby="timeline-h">
            <SectionHeading>
              <span id="timeline-h">Timeline</span>
            </SectionHeading>
            <Card className="p-4">
              <ol className="relative space-y-4 border-l-2 border-line pl-4">
                {events.map((e) => (
                  <li key={e.id} className="relative text-sm">
                    <span
                      aria-hidden="true"
                      className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-accent-600"
                    />
                    <p>
                      <strong className="font-medium">{e.actor.name}</strong>{' '}
                      {describeEvent(e, nameOf)}
                    </p>
                    <p className="text-xs text-ink-subtle" title={formatDate(e.createdAt)}>
                      {timeAgo(e.createdAt)}
                    </p>
                  </li>
                ))}
              </ol>
            </Card>
          </section>

          <section aria-labelledby="comments-h">
            <SectionHeading>
              <span id="comments-h">Comments</span>
            </SectionHeading>
            <div className="space-y-3">
              {comments.length === 0 && <p className="text-sm text-ink-muted">No comments yet.</p>}
              {comments.map((c) => (
                <Card key={c.id} className="p-3 text-sm">
                  <p className="whitespace-pre-wrap">{c.body}</p>
                  <p className="mt-1 text-xs text-ink-subtle">
                    {c.author.name} · {timeAgo(c.createdAt)}
                  </p>
                </Card>
              ))}
              {canWrite && (
                <form onSubmit={addComment} className="space-y-2">
                  <label className="sr-only" htmlFor="new-comment">
                    New comment
                  </label>
                  <textarea
                    id="new-comment"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                    maxLength={5000}
                    placeholder="Add a comment…"
                    className={inputClass}
                  />
                  <Button disabled={!comment.trim()} loading={busy} loadingText="Saving…">
                    Add comment
                  </Button>
                </form>
              )}
            </div>
          </section>
        </aside>
      </div>
    </article>
  );
}
