'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Activity, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import { api, ApiError } from '@/lib/api';
import { AuthCarousel } from '@/components/AuthCarousel';
import { Button, ErrorText, inputClass, linkClass } from '@/components/ui';

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
  alt: { prefix: string; href: string; text: string };
  /** Optional content under the form, such as the demo button. */
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
    <div className="grid min-h-screen lg:grid-cols-[1.4fr_1fr]">
      <AuthCarousel />

      {/* The form side stays light in either theme, like the rest of the sign-in screen's contrast */}
      <main className="theme-light auth-blue flex min-h-screen flex-col justify-center bg-surface px-5 py-10 text-ink sm:px-10">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto w-full max-w-[26rem]"
        >
          <div className="flex flex-col items-center text-center">
            <span
              aria-hidden="true"
              className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-600 shadow-[0_12px_32px_-10px_rgb(47_91_234/0.7)]"
            >
              <Activity className="h-6 w-6 text-white" strokeWidth={2.4} />
            </span>
            <h1 className="mt-6 text-[1.75rem] font-semibold tracking-tight">{title}</h1>
            <p className="mt-1.5 text-sm text-ink-muted">{subtitle}</p>
          </div>

          <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate={false}>
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
                  className={`${inputClass} mt-1.5 rounded-xl py-3`}
                />
                {f.hint && (
                  <p id={`${f.name}-hint`} className="mt-1 text-xs text-ink-muted">
                    {f.hint}
                  </p>
                )}
              </div>
            ))}
            <ErrorText>{error}</ErrorText>
            <Button
              className="w-full !rounded-xl !bg-none !bg-ink py-3.5 !text-canvas !shadow-none hover:opacity-90"
              loading={pending}
              loadingText="Please wait…"
            >
              {submitLabel}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </form>

          {extra}

          <p className="mt-8 text-center text-sm text-ink-muted">
            {alt.prefix}{' '}
            <Link href={alt.href} className={`${linkClass} font-medium`}>
              {alt.text}
            </Link>
          </p>
        </motion.div>
      </main>
    </div>
  );
}
