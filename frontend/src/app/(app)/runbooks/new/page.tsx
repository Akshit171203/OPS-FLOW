'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { roleRank, type RunbookDto } from '@opsflow/shared';
import { Button, ErrorText, Field, inputClass, secondaryButtonClass } from '@/components/ui';
import { BackLink, EmptyState, PageHeader, Panel } from '@/components/feedback';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { useMe } from '@/lib/me-context';
import { usePageTitle } from '@/lib/usePageTitle';

export default function NewRunbookPage() {
  usePageTitle('New runbook');
  const me = useMe();
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (roleRank[me.role] < roleRank.ADMIN) {
    return (
      <EmptyState
        title="Admins only"
        description="Only admins can write runbooks."
        action={
          <Link href="/runbooks" className={secondaryButtonClass}>
            Back to runbooks
          </Link>
        }
      />
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const d = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      const { runbook } = await api<{ runbook: RunbookDto }>('/api/runbooks', {
        method: 'POST',
        json: {
          title: d.title,
          content: d.content,
          ...(d.serviceTag ? { serviceTag: d.serviceTag } : {}),
        },
      });
      toast.success('Runbook saved. It is being indexed for search.');
      router.push(`/runbooks/${runbook.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the runbook.');
      toast.error(err, 'Could not save the runbook.');
      setPending(false);
    }
  }

  return (
    <>
      <BackLink href="/runbooks">Runbooks</BackLink>
      <PageHeader
        title="New runbook"
        description="Write how to diagnose and fix a known problem. The AI analysis searches these."
      />
      <Panel
        headingId="new-runbook-h"
        title="Runbook"
        description="Markdown, one section per heading"
        className="max-w-3xl"
        bodyClassName="p-5"
      >
        <form onSubmit={onSubmit} className="space-y-5">
          <Field label="Title">
            <input
              name="title"
              required
              maxLength={200}
              className={inputClass}
              placeholder="Payment service troubleshooting"
            />
          </Field>
          <Field
            label="Service (optional)"
            hint="A service slug such as payment-service, to say what this runbook is about."
          >
            <input
              name="serviceTag"
              maxLength={100}
              className={inputClass}
              placeholder="payment-service"
            />
          </Field>
          <Field
            label="Content"
            hint="Markdown. Use headings to organise it: each section is indexed separately, so short, focused sections are easier to find."
          >
            <textarea
              name="content"
              required
              rows={16}
              maxLength={50000}
              className={`${inputClass} font-mono`}
              placeholder={'## Symptoms\n...\n\n## Checks\n1. ...'}
            />
          </Field>
          <ErrorText>{error}</ErrorText>
          <div className="flex gap-2">
            <Button loading={pending} loadingText="Saving…">
              Save runbook
            </Button>
            <Link href="/runbooks" className={secondaryButtonClass}>
              Cancel
            </Link>
          </div>
        </form>
      </Panel>
    </>
  );
}
