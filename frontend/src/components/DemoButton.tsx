'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Button, ErrorText } from '@/components/ui';

/** Shown on the login page only when the server is running in demo mode: one click, no sign-up. */
export function DemoButton() {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ enabled: boolean }>('/api/demo/status')
      .then((s) => setEnabled(s.enabled))
      .catch(() => setEnabled(false));
  }, []);

  if (!enabled) return null;

  async function enter() {
    setPending(true);
    setError(null);
    try {
      await api('/api/demo/session', { method: 'POST' });
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not start the demo. Please try again.',
      );
      setPending(false);
    }
  }

  return (
    <div className="mt-5 rounded-lg border border-accent-200 bg-accent-50 p-4 text-center">
      <p className="text-sm text-accent-800">Just looking? No account needed.</p>
      <Button
        className="mt-3 w-full"
        onClick={enter}
        loading={pending}
        loadingText="Opening the demo…"
      >
        Try the live demo
      </Button>
      <p className="mt-2 text-xs text-accent-800">
        Shared sample data. Press “Simulate payment outage” to watch an incident unfold.
      </p>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
