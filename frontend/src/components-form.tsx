'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Button, ErrorText, inputClass, linkClass } from '@/components/ui';
import { Card } from '@/components/feedback';

type Field = { name: string; label: string; type?: string; autoComplete?: string; hint?: string };

export function AuthForm({
  title,
  subtitle,
  endpoint,
  fields,
  submitLabel,
  alt,
  extra,
}: {
  title: string;
  subtitle: string;
  endpoint: string;
  fields: Field[];
  submitLabel: string;
  alt: { href: string; text: string };
  /** Optional content under the card, such as the demo button. */
  extra?: React.ReactNode;
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
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center justify-center gap-2 text-xl font-semibold tracking-tight">
        <span
          aria-hidden="true"
          className="grid h-8 w-8 place-items-center rounded-md bg-accent-600 text-sm font-bold text-white"
        >
          O
        </span>
        OpsFlow
      </div>
      <Card className="p-6">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>
        <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate={false}>
          {fields.map((f) => (
            <div key={f.name}>
              <label htmlFor={f.name} className="block text-sm font-medium">
                {f.label}
              </label>
              <input
                id={f.name}
                name={f.name}
                type={f.type ?? 'text'}
                autoComplete={f.autoComplete}
                required
                aria-describedby={f.hint ? `${f.name}-hint` : undefined}
                className={`${inputClass} mt-1`}
              />
              {f.hint && (
                <p id={`${f.name}-hint`} className="mt-1 text-xs text-ink-muted">
                  {f.hint}
                </p>
              )}
            </div>
          ))}
          <ErrorText>{error}</ErrorText>
          <Button className="w-full" loading={pending} loadingText="Please wait…">
            {submitLabel}
          </Button>
        </form>
      </Card>
      {extra}
      <p className="mt-4 text-center text-sm text-ink-muted">
        <Link href={alt.href} className={linkClass}>
          {alt.text}
        </Link>
      </p>
    </main>
  );
}
