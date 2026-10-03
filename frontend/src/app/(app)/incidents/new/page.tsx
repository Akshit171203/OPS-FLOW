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
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { useMe } from '@/lib/me-context';
import { buttonClass, ErrorText, Field, inputClass } from '@/components/ui';

export default function NewIncidentPage() {
  const me = useMe();
  const router = useRouter();
  const services = useFetch<Paginated<ServiceDto>>('/api/services?limit=100');
  const members = useFetch<{ members: MemberDto[] }>('/api/members');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (roleRank[me.role] < roleRank.ENGINEER) {
    return <p className="text-slate-600">Your role is read-only and cannot create incidents.</p>;
  }
  if (services.data && services.data.items.length === 0) {
    return (
      <p className="text-slate-600">
        There are no services yet.{' '}
        <Link href="/services" className="text-indigo-700 underline">
          Create a project and service first
        </Link>{' '}
        (admin required).
      </p>
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
      router.push(`/incidents/${incident.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setPending(false);
    }
  }

  return (
    <section className="max-w-xl">
      <h1 className="mb-4 text-2xl font-semibold">New incident</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Service">
          <select name="serviceId" required className={inputClass}>
            {services.data?.items.map((s) => (
              <option key={s.id} value={s.id}>
                {s.projectName} / {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title">
          <input name="title" required maxLength={200} className={inputClass} />
        </Field>
        <Field label="Description">
          <textarea name="description" rows={4} maxLength={5000} className={inputClass} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Severity">
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
        <button className={buttonClass} disabled={pending}>
          {pending ? 'Creating…' : 'Create incident'}
        </button>
      </form>
    </section>
  );
}
