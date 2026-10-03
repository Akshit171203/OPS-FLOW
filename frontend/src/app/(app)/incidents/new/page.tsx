'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  priorities,
  roleRank,
  severities,
  type IncidentDto,
  type MemberDto,
  type Paginated,
  type ServiceDto,
} from '@opsflow/shared';
import {
  Button,
  ErrorText,
  Field,
  inputClass,
  linkClass,
  secondaryButtonClass,
} from '@/components/ui';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingRegion,
  PageHeader,
  Skeleton,
} from '@/components/feedback';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { useMe } from '@/lib/me-context';
import { useFetch } from '@/lib/useFetch';
import { usePageTitle } from '@/lib/usePageTitle';

export default function NewIncidentPage() {
  usePageTitle('New incident');
  const me = useMe();
  const router = useRouter();
  const toast = useToast();
  const services = useFetch<Paginated<ServiceDto>>('/api/services?limit=100');
  const members = useFetch<{ members: MemberDto[] }>('/api/members');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (roleRank[me.role] < roleRank.ENGINEER) {
    return (
      <EmptyState
        title="Read-only access"
        description="Your role can view incidents but not open them."
        action={
          <Link href="/incidents" className={secondaryButtonClass}>
            Back to incidents
          </Link>
        }
      />
    );
  }
  if (services.error && !services.data)
    return <ErrorState message={services.error} onRetry={services.reload} />;
  if (!services.data) {
    return (
      <LoadingRegion label="Loading form">
        <Skeleton className="mb-6 h-9 w-56" />
        <Skeleton className="h-96 max-w-xl" />
      </LoadingRegion>
    );
  }
  if (services.data.items.length === 0) {
    return (
      <EmptyState
        title="Create a service first"
        description="An incident is about a service, and there are none yet. An admin can add a project and service."
        action={
          <Link href="/services" className={secondaryButtonClass}>
            Go to Services
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
      const { incident } = await api<{ incident: IncidentDto }>('/api/incidents', {
        method: 'POST',
        json: {
          serviceId: d.serviceId,
          title: d.title,
          severity: d.severity,
          priority: d.priority,
          ...(d.description ? { description: d.description } : {}),
          ...(d.assigneeId ? { assigneeId: d.assigneeId } : {}),
        },
      });
      toast.success('Incident opened.');
      router.push(`/incidents/${incident.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open the incident.');
      toast.error(err, 'Could not open the incident.');
      setPending(false);
    }
  }

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/incidents" className={linkClass}>
          ← Incidents
        </Link>
      </p>
      <PageHeader title="New incident" />
      <Card className="max-w-2xl p-5">
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Service">
            <select name="serviceId" required className={inputClass}>
              {services.data.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.projectName} / {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Title">
            <input
              name="title"
              required
              maxLength={200}
              className={inputClass}
              placeholder="Checkout is returning errors"
            />
          </Field>
          <Field label="Description (optional)">
            <textarea
              name="description"
              rows={4}
              maxLength={5000}
              className={inputClass}
              placeholder="What are people seeing? When did it start?"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Severity" hint="SEV1 is the most serious.">
              <select name="severity" defaultValue="SEV3" className={inputClass}>
                {severities.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <select name="priority" defaultValue="MEDIUM" className={inputClass}>
                {priorities.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Assignee (optional)">
            <select name="assigneeId" className={inputClass}>
              <option value="">Unassigned</option>
              {members.data?.members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name} ({m.role})
                </option>
              ))}
            </select>
          </Field>
          <ErrorText>{error}</ErrorText>
          <div className="flex gap-2">
            <Button loading={pending} loadingText="Opening…">
              Open incident
            </Button>
            <Link href="/incidents" className={secondaryButtonClass}>
              Cancel
            </Link>
          </div>
        </form>
      </Card>
    </>
  );
}
