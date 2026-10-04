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
import {
  Button,
  buttonClass,
  inputClass,
  Pill,
  secondaryButtonClass,
  SeverityBadge,
  StatusBadge,
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
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useMe } from '@/lib/me-context';
import { useReconnect, useSocketEvent } from '@/lib/socket';
import { useFetch } from '@/lib/useFetch';
import { usePageTitle } from '@/lib/usePageTitle';

const PAGE_SIZE = 10;

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-xs font-medium text-ink-muted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} mt-1`}
      >
        {children}
      </select>
    </label>
  );
}

export default function IncidentsPage() {
  usePageTitle('Incidents');
  const me = useMe();
  const router = useRouter();
  const toast = useToast();
  const canCreate = roleRank[me.role] >= roleRank.ENGINEER;
  const isAdmin = roleRank[me.role] >= roleRank.ADMIN;
  const [filters, setFilters] = useState({ status: '', severity: '', serviceId: '' });
  const [page, setPage] = useState(1);
  const [simulating, setSimulating] = useState(false);

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  const filtered = Object.values(filters).some(Boolean);

  const incidents = useFetch<Paginated<IncidentDto>>(`/api/incidents?${params}`);
  const services = useFetch<Paginated<ServiceDto>>('/api/services?limit=100');
  const total = incidents.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // The list stays current while it is open: anyone's change in this organization refreshes it
  useSocketEvent('incident.created', incidents.reload);
  useSocketEvent('incident.updated', incidents.reload);
  useSocketEvent('incident.status_changed', incidents.reload);
  useReconnect(incidents.reload);

  const setFilter = (key: keyof typeof filters) => (v: string) => {
    setFilters((f) => ({ ...f, [key]: v }));
    setPage(1);
  };

  async function simulate() {
    setSimulating(true);
    try {
      const r = await api<SimulateResult>('/api/demo/simulate-incident', { method: 'POST' });
      toast.success('Simulated a payment outage.');
      router.push(`/incidents/${r.incident.id}`);
    } catch (e) {
      toast.error(e, 'Could not simulate an outage.');
      setSimulating(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Incidents"
        description={incidents.data ? `${total} ${filtered ? 'matching' : 'total'}` : undefined}
        actions={
          <>
            {isAdmin && (
              <Button
                variant="secondary"
                onClick={simulate}
                loading={simulating}
                loadingText="Simulating…"
              >
                Simulate payment outage
              </Button>
            )}
            {canCreate && (
              <Link href="/incidents/new" className={buttonClass}>
                New incident
              </Link>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <FilterSelect label="Status" value={filters.status} onChange={setFilter('status')}>
          <option value="">All statuses</option>
          {incidentStatuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </FilterSelect>
        <FilterSelect label="Severity" value={filters.severity} onChange={setFilter('severity')}>
          <option value="">All severities</option>
          {severities.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </FilterSelect>
        <FilterSelect label="Service" value={filters.serviceId} onChange={setFilter('serviceId')}>
          <option value="">All services</option>
          {services.data?.items.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </FilterSelect>
      </div>

      {incidents.error && !incidents.data ? (
        <ErrorState message={incidents.error} onRetry={incidents.reload} />
      ) : !incidents.data ? (
        <LoadingRegion label="Loading incidents">
          <div className="space-y-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        </LoadingRegion>
      ) : incidents.data.items.length === 0 ? (
        filtered ? (
          <EmptyState
            title="No incidents match these filters"
            action={
              <button
                className={secondaryButtonClass}
                onClick={() => {
                  setFilters({ status: '', severity: '', serviceId: '' });
                  setPage(1);
                }}
              >
                Clear filters
              </button>
            }
          />
        ) : (
          <EmptyState
            title="No incidents yet"
            description="When something breaks, open an incident to track it from first report to resolution."
            action={
              <>
                {canCreate && (
                  <Link href="/incidents/new" className={buttonClass}>
                    Open an incident
                  </Link>
                )}
                {isAdmin && (
                  <Button
                    variant="secondary"
                    onClick={simulate}
                    loading={simulating}
                    loadingText="Simulating…"
                  >
                    Simulate an outage
                  </Button>
                )}
              </>
            }
          />
        )
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {incidents.data.items.map((i) => (
              <li key={i.id}>
                <Link
                  href={`/incidents/${i.id}`}
                  className="flex flex-col gap-2 p-4 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{i.title}</p>
                    <p className="mt-0.5 truncate text-xs text-ink-subtle">
                      {i.serviceName} · started {formatDate(i.startedAt)} ·{' '}
                      {i.assignee ? i.assignee.name : 'Unassigned'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    {i.source !== 'manual' && (
                      <Pill className="bg-accent-100 text-accent-800">Alert</Pill>
                    )}
                    <SeverityBadge value={i.severity} />
                    <StatusBadge value={i.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {incidents.data && totalPages > 1 && (
        <nav
          aria-label="Pagination"
          className="mt-4 flex items-center justify-between text-sm text-ink-muted"
        >
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              className={secondaryButtonClass}
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <button
              className={secondaryButtonClass}
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </nav>
      )}
    </>
  );
}
