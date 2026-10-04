'use client';

import { useState } from 'react';
import Link from 'next/link';
import { roleRank, type Paginated, type ProjectDto, type ServiceHealthDto } from '@opsflow/shared';
import { Button, Field, inputClass, ServiceStatusBadge } from '@/components/ui';
import {
  EmptyState,
  ErrorState,
  LoadingRegion,
  PageHeader,
  Panel,
  Skeleton,
} from '@/components/feedback';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { percent, slugify, timeAgo } from '@/lib/format';
import { useMe } from '@/lib/me-context';
import { useFetch } from '@/lib/useFetch';
import { usePageTitle } from '@/lib/usePageTitle';

export default function ServicesPage() {
  usePageTitle('Services');
  const me = useMe();
  const toast = useToast();
  const isAdmin = roleRank[me.role] >= roleRank.ADMIN;
  const projects = useFetch<Paginated<ProjectDto>>('/api/projects?limit=100');
  const health = useFetch<{ services: ServiceHealthDto[] }>('/api/services/health');
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const reload = () => {
    projects.reload();
    health.reload();
  };

  async function run(key: string, success: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try {
      await fn();
      toast.success(success);
      reload();
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function createProject(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const name = String(new FormData(form).get('name'));
    if (
      await run('project', `Project “${name}” created.`, () =>
        api('/api/projects', { method: 'POST', json: { name, slug: slugify(name) } }),
      )
    )
      form.reset();
  }

  async function createService(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = Object.fromEntries(new FormData(form)) as Record<string, string>;
    if (
      await run('service', `Service “${d.name}” created.`, () =>
        api('/api/services', {
          method: 'POST',
          json: { projectId: d.projectId, name: d.name, slug: slugify(d.name!) },
        }),
      )
    )
      form.reset();
  }

  const projectItems = projects.data?.items ?? [];
  const services = health.data?.services ?? [];
  const loading = (projects.loading && !projects.data) || (health.loading && !health.data);
  const error = projects.error ?? health.error;

  const healthyCount = services.filter((s) => s.status === 'HEALTHY').length;
  const description = services.length
    ? `${services.length} service${services.length === 1 ? '' : 's'} · ${healthyCount} healthy${services.length - healthyCount ? ` · ${services.length - healthyCount} need attention` : ''}`
    : 'Health of everything you run, from the latest metrics snapshot.';

  return (
    <>
      <PageHeader
        title="Services"
        description={description}
        actions={
          isAdmin && (
            <Button variant="secondary" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
              {adding ? 'Close' : 'Add project or service'}
            </Button>
          )
        }
      />

      {isAdmin && adding && (
        <Panel
          headingId="catalog-h"
          title="Add to your catalog"
          description="Projects group services; services are what you monitor"
          className="mb-6"
          bodyClassName="grid gap-8 p-5 sm:grid-cols-2"
        >
          <form onSubmit={createProject} className="space-y-3">
            <Field label="New project name">
              <input
                name="name"
                required
                maxLength={100}
                className={inputClass}
                placeholder="Platform"
              />
            </Field>
            <Button loading={busy === 'project'} loadingText="Creating…">
              Create project
            </Button>
          </form>
          <form onSubmit={createService} className="space-y-3">
            <Field label="Project">
              <select
                name="projectId"
                required
                className={inputClass}
                disabled={projectItems.length === 0}
              >
                {projectItems.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="New service name">
              <input
                name="name"
                required
                maxLength={100}
                className={inputClass}
                placeholder="Payment Service"
              />
            </Field>
            <Button
              loading={busy === 'service'}
              loadingText="Creating…"
              disabled={projectItems.length === 0}
            >
              Create service
            </Button>
          </form>
        </Panel>
      )}

      {error && !health.data ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading ? (
        <LoadingRegion label="Loading services">
          <div className="space-y-6">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        </LoadingRegion>
      ) : projectItems.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description={
            isAdmin
              ? 'Create a project, then add the services it contains.'
              : 'Ask an admin to create a project and its services.'
          }
          action={
            isAdmin ? <Button onClick={() => setAdding(true)}>Add a project</Button> : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          {projectItems.map((p) => {
            const mine = services.filter((s) => s.projectName === p.name);
            return (
              <Panel
                key={p.id}
                headingId={`project-${p.id}`}
                title={p.name}
                description={`${mine.length} service${mine.length === 1 ? '' : 's'}`}
              >
                {mine.length === 0 ? (
                  <p className="p-5 text-sm text-ink-muted">No services in this project yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[34rem] text-left text-sm">
                      <thead className="text-xs font-medium text-ink-subtle">
                        <tr className="border-b border-line">
                          <th scope="col" className="px-5 py-2.5 font-medium">
                            Service
                          </th>
                          <th scope="col" className="px-5 py-2.5 font-medium">
                            Health
                          </th>
                          <th scope="col" className="px-5 py-2.5 text-right font-medium">
                            Error rate
                          </th>
                          <th scope="col" className="px-5 py-2.5 text-right font-medium">
                            Latency
                          </th>
                          <th scope="col" className="px-5 py-2.5 text-right font-medium">
                            Updated
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {mine.map((s) => (
                          <tr key={s.id} className="transition-colors hover:bg-surface-2/60">
                            <th scope="row" className="px-5 py-3.5 font-medium">
                              <Link
                                href={`/services/${s.id}`}
                                className="hover:text-accent-ink hover:underline"
                              >
                                {s.name}
                              </Link>
                            </th>
                            <td className="px-5 py-3.5">
                              <ServiceStatusBadge value={s.status} />
                            </td>
                            <td className="px-5 py-3.5 text-right tabular-nums">
                              {s.latestMetric ? percent(s.latestMetric.errorRate) : '—'}
                            </td>
                            <td className="px-5 py-3.5 text-right tabular-nums">
                              {s.latestMetric ? `${s.latestMetric.latencyMs} ms` : '—'}
                            </td>
                            <td className="px-5 py-3.5 text-right text-ink-subtle">
                              {s.latestMetric ? timeAgo(s.latestMetric.capturedAt) : 'no data'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
