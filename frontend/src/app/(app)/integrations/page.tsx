'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  apiKeyScopes,
  roleRank,
  type ApiKeyDto,
  type ApiKeyScope,
  type CreatedApiKeyDto,
  type Paginated,
  type ServiceDto,
} from '@opsflow/shared';
import { CodeBlock } from '@/components/CodeBlock';
import {
  EmptyState,
  ErrorState,
  LoadingRegion,
  PageHeader,
  Panel,
  Skeleton,
} from '@/components/feedback';
import { useToast } from '@/components/toast';
import { Button, Field, inputClass, Pill, secondaryButtonClass } from '@/components/ui';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useMe } from '@/lib/me-context';
import { buildSnippets } from '@/lib/snippets';
import { useFetch } from '@/lib/useFetch';
import { usePageTitle } from '@/lib/usePageTitle';

const SCOPE_HELP: Record<ApiKeyScope, string> = {
  ingest: 'Send logs, metrics and deployments',
  alerts: 'Send alerts that open incidents',
};

export default function IntegrationsPage() {
  usePageTitle('Integrations');
  const me = useMe();
  const toast = useToast();
  const isAdmin = roleRank[me.role] >= roleRank.ADMIN;
  const keys = useFetch<{ keys: ApiKeyDto[] }>(isAdmin ? '/api/api-keys' : null);
  const services = useFetch<Paginated<ServiceDto>>(isAdmin ? '/api/services?limit=100' : null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedApiKeyDto | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [snippetId, setSnippetId] = useState('deploy');
  const [showForm, setShowForm] = useState(false);
  const [origin, setOrigin] = useState('https://your-opsflow-url');
  useEffect(() => setOrigin(window.location.origin), []);

  if (!isAdmin) {
    return (
      <EmptyState
        title="Admins only"
        description="Only owners and admins can create API keys and connect systems."
        action={
          <Link href="/" className={secondaryButtonClass}>
            Back to the dashboard
          </Link>
        }
      />
    );
  }

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const scopes = apiKeyScopes.filter((s) => fd.get(`scope-${s}`) === 'on');
    if (scopes.length === 0) {
      toast.error('Choose at least one permission for the key.');
      return;
    }
    setCreating(true);
    try {
      const body: Record<string, unknown> = { name: String(fd.get('name')), scopes };
      if (fd.get('serviceId')) body.serviceId = String(fd.get('serviceId'));
      const res = await api<{ key: CreatedApiKeyDto }>('/api/api-keys', {
        method: 'POST',
        json: body,
      });
      setCreated(res.key);
      toast.success('API key created. Copy it now: it is shown only once.');
      form.reset();
      keys.reload();
    } catch (err) {
      toast.error(err, 'Could not create the key.');
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string, name: string) {
    setRevoking(id);
    try {
      await api(`/api/api-keys/${id}`, { method: 'DELETE' });
      toast.success(`“${name}” revoked. It stops working immediately.`);
      setConfirmRevoke(null);
      keys.reload();
    } catch (err) {
      toast.error(err, 'Could not revoke the key.');
    } finally {
      setRevoking(null);
    }
  }

  const slug =
    services.data?.items.find((s) => s.id === created?.serviceId)?.slug ??
    services.data?.items[0]?.slug ??
    'your-service';
  const snippets = buildSnippets(origin, created?.key ?? 'YOUR_API_KEY', slug);
  const snippet = snippets.find((s) => s.id === snippetId)!;

  const formOpen = showForm || (keys.data?.keys.length === 0 && !created);

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connect your own systems so deployments, logs, metrics and alerts arrive without anyone typing them in."
      />

      <div className="space-y-6">
        <Panel
          headingId="keys-h"
          title="API keys"
          description="Machine credentials your systems use to send alerts, deployments, logs and metrics"
          action={
            <Button
              variant="secondary"
              onClick={() => setShowForm((f) => !f)}
              aria-expanded={formOpen}
            >
              {formOpen ? 'Close' : 'New API key'}
            </Button>
          }
        >
          {created && (
            <div role="alert" className="m-5 rounded-lg border border-notice-line bg-notice-bg p-4">
              <p className="font-medium text-notice-fg">
                Copy your new key now. You will not be able to see it again.
              </p>
              <p className="mt-1 text-sm text-notice-fg">
                Anyone with this key can send data into <strong>{me.organization.name}</strong> as “
                {created.name}”. Store it as a secret, never in code.
              </p>
              <div className="mt-3">
                <CodeBlock code={created.key} label="API key" />
              </div>
              <button className={`${secondaryButtonClass} mt-3`} onClick={() => setCreated(null)}>
                I have saved it
              </button>
            </div>
          )}

          {formOpen && (
            <form onSubmit={create} className="grid gap-5 border-b border-line p-5 sm:grid-cols-2">
              <Field
                label="Name"
                hint="What will use this key, for example “payment-ci” or “grafana”."
              >
                <input
                  name="name"
                  required
                  maxLength={100}
                  className={inputClass}
                  placeholder="payment-ci"
                />
              </Field>
              <Field
                label="Limit to one service (optional)"
                hint="A tied key can only act on that service, and can leave the service out of requests."
              >
                <select name="serviceId" className={inputClass}>
                  <option value="">Any service</option>
                  {services.data?.items.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.projectName} / {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <fieldset className="sm:col-span-2">
                <legend className="text-sm font-medium">Permissions</legend>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                  {apiKeyScopes.map((s) => (
                    <label key={s} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name={`scope-${s}`}
                        defaultChecked
                        className="h-4 w-4 accent-accent-600"
                      />
                      <span>
                        <span className="font-medium">{s}</span>{' '}
                        <span className="text-ink-muted">— {SCOPE_HELP[s]}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="sm:col-span-2">
                <Button loading={creating} loadingText="Creating…">
                  Create API key
                </Button>
              </div>
            </form>
          )}

          {keys.error && !keys.data ? (
            <div className="p-5">
              <ErrorState message={keys.error} onRetry={keys.reload} />
            </div>
          ) : !keys.data ? (
            <div className="p-5">
              <LoadingRegion label="Loading keys">
                <Skeleton className="h-24" />
              </LoadingRegion>
            </div>
          ) : keys.data.keys.length === 0 ? (
            <p className="p-5 text-sm text-ink-muted">
              No API keys yet. Create one above, then use it in the snippets below.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="text-xs font-medium text-ink-subtle">
                  <tr className="border-b border-line">
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      Name
                    </th>
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      Key
                    </th>
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      Can
                    </th>
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      Last used
                    </th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {keys.data.keys.map((k) => (
                    <tr key={k.id} className={k.revokedAt ? 'text-ink-subtle' : undefined}>
                      <th scope="row" className="px-5 py-3.5 font-medium">
                        {k.name}
                        {k.serviceName && (
                          <span className="block text-xs font-normal text-ink-muted">
                            only {k.serviceName}
                          </span>
                        )}
                      </th>
                      <td className="px-5 py-3.5 font-mono text-xs">{k.keyPrefix}…</td>
                      <td className="px-5 py-3.5">
                        <span className="flex flex-wrap gap-1">
                          {k.scopes.map((sc) => (
                            <Pill key={sc} className="bg-surface-2 text-ink-muted">
                              {sc}
                            </Pill>
                          ))}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-ink-muted">
                        {k.lastUsedAt ? timeAgo(k.lastUsedAt) : 'never'}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {k.revokedAt ? (
                          <Pill className="bg-closed-bg text-closed-fg">Revoked</Pill>
                        ) : confirmRevoke === k.id ? (
                          <span className="inline-flex gap-2">
                            <Button
                              variant="secondary"
                              loading={revoking === k.id}
                              loadingText="Revoking…"
                              onClick={() => revoke(k.id, k.name)}
                            >
                              Yes, revoke
                            </Button>
                            <button
                              className={secondaryButtonClass}
                              onClick={() => setConfirmRevoke(null)}
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            className={secondaryButtonClass}
                            onClick={() => setConfirmRevoke(k.id)}
                            aria-label={`Revoke ${k.name}`}
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          headingId="connect-h"
          title="Connect your systems"
          description={
            <>
              {created
                ? 'Your new key is filled in below.'
                : 'Replace YOUR_API_KEY with a key from above.'}{' '}
              Services are referred to by their slug, such as{' '}
              <code className="rounded bg-surface-2 px-1 font-mono text-xs">{slug}</code>.
            </>
          }
          bodyClassName="space-y-5 p-5"
        >
          <div
            role="tablist"
            aria-label="Integration type"
            className="inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-surface-2 p-1"
          >
            {snippets.map((sn) => (
              <button
                key={sn.id}
                role="tab"
                aria-selected={snippetId === sn.id}
                onClick={() => setSnippetId(sn.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  snippetId === sn.id
                    ? 'bg-surface text-ink shadow-sm'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {sn.title.split(' (')[0]}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="space-y-3">
            <div>
              <h3 className="font-medium">{snippet.title}</h3>
              <p className="mt-0.5 text-sm text-ink-muted">{snippet.description}</p>
            </div>
            <CodeBlock code={snippet.code} label={snippet.title} />
          </div>
          <p className="text-xs text-ink-subtle">
            Want to see it work without wiring anything up? Run{' '}
            <code className="rounded bg-surface-2 px-1 font-mono">pnpm demo:shop</code>: a small
            website that reports to OpsFlow and that you can crash on purpose. Details are in{' '}
            <code className="rounded bg-surface-2 px-1 font-mono">docs/INTEGRATIONS.md</code>.
          </p>
        </Panel>
      </div>
    </>
  );
}
