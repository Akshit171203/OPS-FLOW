'use client';

import { useState } from 'react';
import Link from 'next/link';
import { roleRank, type Paginated, type RunbookDto } from '@opsflow/shared';
import { Button, buttonClass, linkClass, Pill } from '@/components/ui';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingRegion,
  PageHeader,
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
        <Card>
          <ul className="divide-y divide-line">
            {list.data.items.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <Link href={`/runbooks/${r.id}`} className={`${linkClass} font-medium`}>
                    {r.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-ink-subtle">
                    {r.chunkCount} section{r.chunkCount === 1 ? '' : 's'} indexed · updated{' '}
                    {timeAgo(r.updatedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {r.serviceTag && (
                    <Pill className="border border-line bg-surface text-ink-muted">
                      {r.serviceTag}
                    </Pill>
                  )}
                  <IndexStatusBadge status={r.indexStatus} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
