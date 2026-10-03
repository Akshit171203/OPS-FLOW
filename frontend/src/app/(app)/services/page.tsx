'use client';

import { useState } from 'react';
import {
  roleRank,
  serviceStatuses,
  type Paginated,
  type ProjectDto,
  type ServiceDto,
  type ServiceStatus,
} from '@opsflow/shared';
import { api, ApiError } from '@/lib/api';
import { slugify } from '@/lib/format';
import { useFetch } from '@/lib/useFetch';
import { useMe } from '@/lib/me-context';
import { buttonClass, ErrorText, Field, inputClass, ServiceStatusBadge } from '@/components/ui';

export default function ServicesPage() {
  const me = useMe();
  const isAdmin = roleRank[me.role] >= roleRank.ADMIN;
  const projects = useFetch<Paginated<ProjectDto>>('/api/projects?limit=100');
  const services = useFetch<Paginated<ServiceDto>>('/api/services?limit=100');
  const [error, setError] = useState<string | null>(null);

  const reloadAll = () => {
    projects.reload();
    services.reload();
  };
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      reloadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
    }
  };

  async function createProject(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const name = String(new FormData(form).get('name'));
    await run(() => api('/api/projects', { method: 'POST', json: { name, slug: slugify(name) } }));
    form.reset();
  }
  async function createService(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    await run(() =>
      api('/api/services', {
        method: 'POST',
        json: { projectId: data.projectId, name: data.name, slug: slugify(data.name!) },
      }),
    );
    form.reset();
  }

  const projectItems = projects.data?.items ?? [];
  const serviceItems = services.data?.items ?? [];

  return (
    <section className="space-y-8">
      <h1 className="text-2xl font-semibold">Services</h1>
      <ErrorText>{error ?? projects.error ?? services.error}</ErrorText>

      {isAdmin && (
        <div className="grid gap-6 rounded border border-slate-200 bg-white p-4 sm:grid-cols-2">
          <form onSubmit={createProject} className="space-y-3">
            <h2 className="font-medium">New project</h2>
            <Field label="Name">
              <input name="name" required className={inputClass} />
            </Field>
            <button className={buttonClass}>Create project</button>
          </form>
          <form onSubmit={createService} className="space-y-3">
            <h2 className="font-medium">New service</h2>
            <Field label="Project">
              <select name="projectId" required className={inputClass}>
                {projectItems.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Name">
              <input name="name" required className={inputClass} />
            </Field>
            <button className={buttonClass} disabled={projectItems.length === 0}>
              Create service
            </button>
          </form>
        </div>
      )}

      {projects.loading || services.loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : projectItems.length === 0 ? (
        <p className="text-slate-600">
          No projects yet.{isAdmin ? ' Create one above.' : ' Ask an admin to create one.'}
        </p>
      ) : (
        projectItems.map((p) => (
          <div key={p.id}>
            <h2 className="mb-2 font-medium">{p.name}</h2>
            <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
              {serviceItems.filter((s) => s.projectId === p.id).length === 0 && (
                <li className="p-3 text-sm text-slate-500">No services in this project.</li>
              )}
              {serviceItems
                .filter((s) => s.projectId === p.id)
                .map((s) => (
                  <li key={s.id} className="flex items-center justify-between p-3">
                    <span>{s.name}</span>
                    {isAdmin ? (
                      <select
                        aria-label={`Status of ${s.name}`}
                        value={s.status}
                        onChange={(e) =>
                          run(() =>
                            api(`/api/services/${s.id}`, {
                              method: 'PATCH',
                              json: { status: e.target.value as ServiceStatus },
                            }),
                          )
                        }
                        className="rounded border border-slate-300 px-2 py-1 text-sm"
                      >
                        {serviceStatuses.map((st) => (
                          <option key={st}>{st}</option>
                        ))}
                      </select>
                    ) : (
                      <ServiceStatusBadge value={s.status} />
                    )}
                  </li>
                ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
