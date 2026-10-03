'use client';

import { useEffect } from 'react';
import { buttonClass } from '@/components/ui';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-muted">
        An unexpected error stopped this page from loading. Your data is safe.
      </p>
      <button onClick={reset} className={`${buttonClass} mt-6`}>
        Try again
      </button>
    </main>
  );
}
