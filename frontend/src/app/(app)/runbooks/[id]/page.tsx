'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { RunbookDto } from '@opsflow/shared';
import { linkClass, Pill } from '@/components/ui';
import {
  Card,
  ErrorState,
  LoadingRegion,
  PageHeader,
  Skeleton,
  SkeletonLines,
} from '@/components/feedback';
import { Markdown } from '@/components/Markdown';
import { IndexStatusBadge } from '@/components/RunbookStatus';
import { timeAgo } from '@/lib/format';
import { useFetch } from '@/lib/useFetch';
import { usePageTitle } from '@/lib/usePageTitle';
import { usePolling } from '@/lib/usePolling';

export default function RunbookPage() {
  const { id } = useParams<{ id: string }>();
  const rb = useFetch<{ runbook: RunbookDto }>(`/api/runbooks/${id}`);
  const runbook = rb.data?.runbook;
  usePageTitle(runbook?.title ?? 'Runbook');
  usePolling(runbook?.indexStatus === 'PENDING', rb.reload);

  if (rb.error && !runbook) return <ErrorState message={rb.error} onRetry={rb.reload} />;
  if (!runbook) {
    return (
      <LoadingRegion label="Loading runbook">
        <Skeleton className="mb-6 h-9 w-72" />
        <Card className="p-5">
          <SkeletonLines lines={6} />
        </Card>
      </LoadingRegion>
    );
  }

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/runbooks" className={linkClass}>
          ← Runbooks
        </Link>
      </p>
      <PageHeader
        title={runbook.title}
        description={`Updated ${timeAgo(runbook.updatedAt)}`}
        actions={
          <>
            {runbook.serviceTag && (
              <Pill className="border border-line bg-surface text-ink-muted">
                {runbook.serviceTag}
              </Pill>
            )}
            <IndexStatusBadge status={runbook.indexStatus} />
          </>
        }
      />
      {runbook.indexStatus === 'FAILED' && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-danger-line bg-danger-bg p-4 text-sm text-danger-fg"
        >
          <p className="font-medium">
            This runbook could not be indexed, so the AI analysis cannot find it.
          </p>
          <p className="mt-1">{runbook.indexError}</p>
        </div>
      )}
      <Card className="max-w-3xl p-5">
        <Markdown source={runbook.content ?? ''} />
      </Card>
      <p className="mt-3 text-xs text-ink-subtle">
        {runbook.indexStatus === 'INDEXED'
          ? `${runbook.chunkCount} sections indexed ${runbook.indexedAt ? timeAgo(runbook.indexedAt) : ''}.`
          : null}
      </p>
    </>
  );
}
