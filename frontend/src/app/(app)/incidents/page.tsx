'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Flame, Plus } from 'lucide-react';
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
import { timeAgo } from '@/lib/format';
import { useMe } from '@/lib/me-context';
import { useReconnect, useSocketEvent } from '@/lib/socket';
import { useFetch } from '@/lib/useFetch';
import { usePageTitle } from '@/lib/usePageTitle';

const PAGE_SIZE = 10;

const sevBar = {
  SEV1: 'bg-sev1-fg',
  SEV2: 'bg-sev2-fg',
  SEV3: 'bg-sev3-fg',
  SEV4: 'bg-sev4-fg',
} as const;

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
    <label className="block">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} py-1.5`}
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
                <Flame className="h-4 w-4" aria-hidden="true" />
                Simulate payment outage
              </Button>
            )}
            {canCreate && (
              <Link href="/incidents/new" className={buttonClass}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                New incident
              </Link>
            )}
          </>
        }
      />

      <div
        role="group"
        aria-label="Filter by status"
        className="mb-4 flex flex-wrap items-center gap-1.5"
      >
        {['', ...incidentStatuses].map((st) => {
          const active = filters.status === st;
          return (
            <button
              key={st || 'all'}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter('status')(st)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-ink text-canvas'
                  : 'text-ink-muted ring-1 ring-inset ring-line hover:bg-surface-2 hover:text-ink'
              }`}
            >
              {st ? st.charAt(0) + st.slice(1).toLowerCase() : 'All'}
            </button>
          );
        })}
        <div className="ml-auto grid w-full grid-cols-2 gap-2 sm:w-auto sm:grid-cols-[10rem_12rem]">
          <FilterSelect label="Severity" value={filters.severity} onChange={setFilter('severity')}>
            <option value="">All severities</option>
            {severities.map((sv) => (
              <option key={sv}>{sv}</option>
            ))}
          </FilterSelect>
          <FilterSelect label="Service" value={filters.serviceId} onChange={setFilter('serviceId')}>
            <option value="">All services</option>
            {services.data?.items.map((sv) => (
              <option key={sv.id} value={sv.id}>
                {sv.name}
              </option>
            ))}
          </FilterSelect>
        </div>
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
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {incidents.data.items.map((i) => (
              <li key={i.id}>
                <Link
                  href={`/incidents/${i.id}`}
                  className="group relative flex flex-col gap-2 py-4 pl-5 pr-4 transition-colors hover:bg-surface-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <span
                    aria-hidden="true"
                    className={`absolute inset-y-0 left-0 w-[3px] ${sevBar[i.severity]}`}
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium group-hover:text-accent-ink">{i.title}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-subtle">
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 font-medium text-ink-muted">
                        {i.serviceName}
                      </span>
                      <span title={new Date(i.startedAt).toLocaleString()}>
                        started {timeAgo(i.startedAt)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{i.assignee ? i.assignee.name : 'Unassigned'}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {i.source !== 'manual' && (
                      <Pill className="bg-accent-soft text-accent-ink">Alert</Pill>
                    )}
                    <SeverityBadge value={i.severity} />
                    <StatusBadge value={i.status} />
                    {i.assignee && (
                      <span
                        aria-hidden="true"
                        title={i.assignee.name}
                        className="ml-1 grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-accent-600 to-[#8b5cf6] text-[10px] font-semibold text-white"
                      >
                        {i.assignee.name
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((w) => w[0]?.toUpperCase())
                          .join('')}
                      </span>
                    )}
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
