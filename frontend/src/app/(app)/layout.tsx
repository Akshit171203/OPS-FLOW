'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MeResponse } from '@opsflow/shared';
import { api, ApiError } from '@/lib/api';
import { MeContext } from '@/lib/me-context';

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    api<MeResponse>('/api/auth/me')
      .then(setMe)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/login');
      });
  }, [router]);

  if (!me) return <p className="p-6 text-slate-500">Loading…</p>;

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  return (
    <MeContext.Provider value={me}>
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <span className="font-semibold">OpsFlow</span>
        <div className="flex items-center gap-4 text-sm">
          <span>{me.user.email}</span>
          <button onClick={logout} className="text-indigo-700 underline">
            Sign out
          </button>
        </div>
      </header>
      <div className="mx-auto max-w-5xl p-6">{children}</div>
    </MeContext.Provider>
  );
}
