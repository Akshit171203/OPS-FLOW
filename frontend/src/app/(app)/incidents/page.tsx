'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  incidentStatuses,
  roleRank,
  severities,
  type IncidentDto,
  type Paginated,
  type ServiceDto,
  type SimulateResult,
} from '@opsflow/shared';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useReconnect, useSocketEvent } from '@/lib/socket';
import { useFetch } from '@/lib/useFetch';
import { useMe } from '@/lib/me-context';
import {
  buttonClass,
  ErrorText,
  inputClass,
  secondaryButtonClass,
  SeverityBadge,
  StatusBadge,
} from '@/components/ui';

const PAGE_SIZE = 10;

export default function IncidentsPage() {
  const me = useMe();
  const router = useRouter();
  const canCreate = roleRank[me.role] >= roleRank.ENGINEER;
  const isAdmin = roleRank[me.role] >= roleRank.ADMIN;
  const [simulating, setSimulating] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ status: '', severity: '', serviceId: '' });
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);

  const incidents = useFetch<Paginated<IncidentDto>>(`/api/incidents?${params}`);
  const services = useFetch<Paginated<ServiceDto>>('/api/services?limit=100');
  // The list stays current while it is open: anyone's change in this organization refreshes it.
  useSocketEvent('incident.created', incidents.reload);
  useSocketEvent('incident.updated', incidents.reload);
  useSocketEvent('incident.status_changed', incidents.reload);
  useReconnect(incidents.reload);

  async function simulate() {
    setSimError(null);
    setSimulating(true);
    try {
      const result = await api<SimulateResult>('/api/demo/simulate-incident', { method: 'POST' });
      router.push(`/incidents/${result.incident.id}`);
    } catch (e) {
      setSimError(e instanceof ApiError ? e.message : 'Simulation failed');
      setSimulating(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil((incidents.data?.total ?? 0) / PAGE_SIZE));

  const setFilter = (key: keyof typeof filters) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
  };

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Incidents</h1>
        <div className="flex gap-2">
          {isAdmin && (
            <button className={secondaryButtonClass} onClick={simulate} disabled={simulating}>
              {simulating ? 'Simulating…' : 'Simulate payment outage'}
            </button>
          )}
          {canCreate && (
            <Link href="/incidents/new" className={buttonClass}>
              New incident
            </Link>
          )}
        </div>
      </div>
      <ErrorText>{simError}</ErrorText>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <select
          aria-label="Status"
          value={filters.status}
          onChange={setFilter('status')}
          className={inputClass}
        >
          <option value="">All statuses</option>
          {incidentStatuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="Severity"
          value={filters.severity}
          onChange={setFilter('severity')}
          className={inputClass}
        >
          <option value="">All severities</option>
          {severities.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="Service"
          value={filters.serviceId}
          onChange={setFilter('serviceId')}
          className={inputClass}
        >
          <option value="">All services</option>
          {services.data?.items.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <ErrorText>{incidents.error}</ErrorText>
      {incidents.loading && !incidents.data ? (
        <p className="text-slate-500">Loading…</p>
      ) : incidents.data?.items.length === 0 ? (
        <p className="rounded border border-slate-200 bg-white p-6 text-slate-600">
          No incidents match.{canCreate ? ' Create one with “New incident”.' : ''}
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
          {incidents.data?.items.map((i) => (
            <li key={i.id}>
              <Link
                href={`/incidents/${i.id}`}
                className="flex items-center justify-between gap-4 p-3 hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{i.title}</p>
                  <p className="text-xs text-slate-500">
                    {i.serviceName} · {formatDate(i.startedAt)}
                    {i.assignee ? ` · ${i.assignee.name}` : ' · Unassigned'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <SeverityBadge value={i.severity} />
                  <StatusBadge value={i.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
        <span>{incidents.data?.total ?? 0} total</span>
        <div className="flex items-center gap-2">
          <button
            className={secondaryButtonClass}
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            className={secondaryButtonClass}
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
