'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MeResponse } from '@opsflow/shared';
import { Skeleton } from '@/components/feedback';
import { AppShell } from '@/components/shell/AppShell';
import { api, ApiError } from '@/lib/api';
import { MeContext } from '@/lib/me-context';

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api<MeResponse>('/api/auth/me')
      .then(setMe)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/login');
        else setFailed(true);
      });
  }, [router]);

  if (failed) {
    return (
      <div
        role="alert"
        className="mx-auto mt-24 max-w-md rounded-lg border border-danger-line bg-danger-bg p-6 text-center"
      >
        <p className="font-medium text-danger-fg">OpsFlow could not reach the server.</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-3 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm font-medium"
        >
          Reload
        </button>
      </div>
    );
  }
  if (!me) {
    return (
      <div role="status" aria-busy="true" className="p-6">
        <span className="sr-only">Loading…</span>
        <Skeleton className="mb-4 h-8 w-48" />
        <Skeleton className="h-40 w-full max-w-3xl" />
      </div>
    );
  }

  async function signOut() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
  }

  return (
    <MeContext.Provider value={me}>
      <AppShell me={me} onSignOut={signOut}>
        {children}
      </AppShell>
    </MeContext.Provider>
  );
}
