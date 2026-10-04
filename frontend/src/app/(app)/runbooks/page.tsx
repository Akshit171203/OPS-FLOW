'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BookOpen, ChevronRight } from 'lucide-react';
import { roleRank, type Paginated, type RunbookDto } from '@opsflow/shared';
import { Button, buttonClass, Pill } from '@/components/ui';
import {
  EmptyState,
  ErrorState,
  LoadingRegion,
  PageHeader,
  Panel,
  Skeleton,
} from '@/components/feedback';
import { IndexStatusBadge } from '@/components/RunbookStatus';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useMe } from '@/lib/me-context';
import { useFetch } from '@/lib/useFetch';
import { usePageTitle } from '@/lib/usePageTitle';
import { usePolling } from '@/lib/usePolling';

export default function RunbooksPage() {
  usePageTitle('Runbooks');
  const me = useMe();
  const toast = useToast();
  const isAdmin = roleRank[me.role] >= roleRank.ADMIN;
  const list = useFetch<Paginated<RunbookDto>>('/api/runbooks?limit=100');
  const [reindexing, setReindexing] = useState(false);

  // Indexing runs in the background and sends no push event, so poll while anything is pending
  const pending = list.data?.items.some((r) => r.indexStatus === 'PENDING') ?? false;
  usePolling(pending, list.reload);

  async function reindexAll() {
    setReindexing(true);
    try {
      const r = await api<{ queued: number }>('/api/runbooks/reindex-all', { method: 'POST' });
      toast.success(`Re-indexing ${r.queued} runbook${r.queued === 1 ? '' : 's'}.`);
      list.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setReindexing(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Runbooks"
        description="Playbooks your team has written. The AI analysis searches them for guidance relevant to an incident."
        actions={
          isAdmin && (
            <>
              <Button
                variant="secondary"
                onClick={reindexAll}
                loading={reindexing}
                loadingText="Queuing…"
                disabled={!list.data?.items.length}
              >
                Re-index all
              </Button>
              <Link href="/runbooks/new" className={buttonClass}>
                New runbook
              </Link>
            </>
          )
        }
      />

      {list.error && !list.data ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <LoadingRegion label="Loading runbooks">
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        </LoadingRegion>
      ) : list.data.items.length === 0 ? (
        <EmptyState
          title="No runbooks yet"
          description="Runbooks capture how to diagnose and fix known problems, so on-call engineers (and the AI analysis) do not start from scratch."
          action={
            isAdmin ? (
              <Link href="/runbooks/new" className={buttonClass}>
                Write the first runbook
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Panel
          headingId="runbooks-h"
          title="All runbooks"
          description={`${list.data.items.length} runbook${list.data.items.length === 1 ? '' : 's'} · ${list.data.items.filter((r) => r.indexStatus === 'INDEXED').length} searchable by the AI analysis`}
        >
          <ul className="divide-y divide-line">
            {list.data.items.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/runbooks/${r.id}`}
                  className="group flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-surface-2/60"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-ink-muted"
                    >
                      <BookOpen className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium group-hover:text-accent-ink">{r.title}</p>
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        {r.chunkCount} section{r.chunkCount === 1 ? '' : 's'} indexed · updated{' '}
                        {timeAgo(r.updatedAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.serviceTag && (
                      <Pill className="bg-surface-2 text-ink-muted">{r.serviceTag}</Pill>
                    )}
                    <IndexStatusBadge status={r.indexStatus} />
                    <ChevronRight className="h-4 w-4 text-ink-subtle" aria-hidden="true" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
