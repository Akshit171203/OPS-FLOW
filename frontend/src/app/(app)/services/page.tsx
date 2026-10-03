'use client';

import { useState } from 'react';
import Link from 'next/link';
import { roleRank, type Paginated, type ProjectDto, type ServiceHealthDto } from '@opsflow/shared';
import { Button, Field, inputClass, linkClass, ServiceStatusBadge } from '@/components/ui';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingRegion,
  PageHeader,
  SectionHeading,
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

  return (
    <>
      <PageHeader
        title="Services"
        description="Health of everything you run, from the latest metrics snapshot."
      />

      {isAdmin && (
        <Card className="mb-6 p-4">
          <SectionHeading>Add to your catalog</SectionHeading>
          <div className="grid gap-6 sm:grid-cols-2">
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
          </div>
        </Card>
      )}

      {error && !health.data ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading ? (
        <LoadingRegion label="Loading services">
          <div className="space-y-6">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        </LoadingRegion>
      ) : projectItems.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description={
            isAdmin
              ? 'Create a project above, then add the services it contains.'
              : 'Ask an admin to create a project and its services.'
          }
        />
      ) : (
        <div className="space-y-6">
          {projectItems.map((p) => {
            const mine = services.filter((s) => s.projectName === p.name);
            return (
              <section key={p.id} aria-label={`${p.name} services`}>
                <SectionHeading>{p.name}</SectionHeading>
                {mine.length === 0 ? (
                  <Card className="p-4 text-sm text-ink-muted">
                    No services in this project yet.
                  </Card>
                ) : (
                  <Card className="overflow-x-auto">
                    <table className="w-full min-w-[34rem] text-left text-sm">
                      <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-muted">
                        <tr>
                          <th scope="col" className="px-4 py-2 font-medium">
                            Service
                          </th>
                          <th scope="col" className="px-4 py-2 font-medium">
                            Health
                          </th>
                          <th scope="col" className="px-4 py-2 text-right font-medium">
                            Error rate
                          </th>
                          <th scope="col" className="px-4 py-2 text-right font-medium">
                            Latency
                          </th>
                          <th scope="col" className="px-4 py-2 text-right font-medium">
                            Updated
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {mine.map((s) => (
                          <tr key={s.id}>
                            <th scope="row" className="px-4 py-3 font-medium">
                              <Link href={`/services/${s.id}`} className={linkClass}>
                                {s.name}
                              </Link>
                            </th>
                            <td className="px-4 py-3">
                              <ServiceStatusBadge value={s.status} />
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {s.latestMetric ? percent(s.latestMetric.errorRate) : '—'}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {s.latestMetric ? `${s.latestMetric.latencyMs} ms` : '—'}
                            </td>
                            <td className="px-4 py-3 text-right text-ink-subtle">
                              {s.latestMetric ? timeAgo(s.latestMetric.capturedAt) : 'no data'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
