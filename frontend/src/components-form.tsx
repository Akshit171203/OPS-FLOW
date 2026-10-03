'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';

type Field = { name: string; label: string; type?: string; autoComplete?: string };

export function AuthForm({
  title,
  endpoint,
  fields,
  submitLabel,
  alt,
}: {
  title: string;
  endpoint: string;
  fields: Field[];
  submitLabel: string;
  alt: { href: string; text: string };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      await api(endpoint, { method: 'POST', json: data });
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-6 text-2xl font-semibold">{title}</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        {fields.map((f) => (
          <label key={f.name} className="block text-sm font-medium">
            {f.label}
            <input
              name={f.name}
              type={f.type ?? 'text'}
              autoComplete={f.autoComplete}
              required
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-base focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </label>
        ))}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          disabled={pending}
          className="w-full rounded bg-indigo-600 px-3 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {pending ? 'Please wait…' : submitLabel}
        </button>
      </form>
      <p className="mt-4 text-sm text-slate-600">
        <Link href={alt.href} className="text-indigo-700 underline">
          {alt.text}
        </Link>
      </p>
    </main>
  );
}
