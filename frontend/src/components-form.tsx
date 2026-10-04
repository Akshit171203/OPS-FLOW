'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Activity, BookOpen, Rocket, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { api, ApiError } from '@/lib/api';
import {
  Button,
  ErrorText,
  inputClass,
  linkClass,
  SeverityBadge,
  StatusBadge,
} from '@/components/ui';
import { ThemeToggle } from '@/components/ThemeToggle';

type Field = { name: string; label: string; type?: string; autoComplete?: string; hint?: string };

function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 text-xl font-semibold tracking-tight ${className}`}>
      <span
        aria-hidden="true"
        className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-accent-600 to-[#8b5cf6] shadow-[0_0_28px_-4px_rgb(99_91_255/0.7),inset_0_1px_0_rgb(255_255_255/0.3)]"
      >
        <Activity className="h-[18px] w-[18px] text-white" strokeWidth={2.6} />
      </span>
      OpsFlow
    </div>
  );
}

const highlights = [
  { icon: Rocket, text: 'Alerts open incidents on their own and link the deploy that did it' },
  { icon: Sparkles, text: 'AI reads logs, metrics and your runbooks, then suggests causes' },
  { icon: BookOpen, text: 'One live timeline for the whole team, with an audit trail' },
];

/** Left half of the sign-in screen: what the product does, with a miniature of the real UI. */
function Showcase() {
  return (
    <div className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-surface p-10 lg:flex">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 h-[28rem] w-[28rem] rounded-full bg-accent-600/30 blur-3xl motion-safe:animate-drift" />
        <div className="absolute -bottom-32 right-[-6rem] h-[26rem] w-[26rem] rounded-full bg-sky-500/20 blur-3xl motion-safe:animate-drift [animation-delay:-9s]" />
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgb(120 130 160 / 0.08) 1px, transparent 1px), linear-gradient(to bottom, rgb(120 130 160 / 0.08) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
            maskImage: 'radial-gradient(ellipse at 30% 20%, #000, transparent 75%)',
          }}
        />
      </div>

      <Logo className="relative" />

      <div className="relative">
        <h2 className="max-w-md text-4xl font-semibold leading-[1.1] tracking-tight">
          Respond before your users notice.
        </h2>
        <ul className="mt-6 max-w-md space-y-3">
          {highlights.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3 text-sm text-ink-muted">
              <span
                aria-hidden="true"
                className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent-soft text-accent-ink"
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              {text}
            </li>
          ))}
        </ul>

        <div aria-hidden="true" className="mt-10 max-w-md motion-safe:animate-float">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="card-surface rounded-2xl p-4 shadow-2xl"
          >
            <div className="flex items-center gap-2">
              <SeverityBadge value="SEV1" />
              <StatusBadge value="OPEN" />
              <span className="ml-auto text-xs text-ink-subtle">just now</span>
            </div>
            <p className="mt-2.5 font-medium">Payment failures spiking after v2.4.0 rollout</p>
            <p className="mt-0.5 text-xs text-ink-subtle">Payment Service · opened by alert</p>
            <div className="mt-3 rounded-lg border border-line bg-surface-2/70 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-accent-ink">
                <Sparkles className="h-3.5 w-3.5" /> AI analysis
              </p>
              <p className="mt-1 text-sm">Connection pool exhaustion after deployment v2.4.0</p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-skeleton">
                <div className="h-full w-[82%] rounded-full bg-gradient-to-r from-accent-600 to-[#8b5cf6]" />
              </div>
              <p className="mt-1 text-right text-[11px] tabular-nums text-ink-subtle">
                82% confidence
              </p>
            </div>
          </motion.div>
        </div>
      </div>

      <p className="relative text-xs text-ink-subtle">Incident response for engineering teams.</p>
    </div>
  );
}

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
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <Showcase />
      <main className="relative flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto w-full max-w-sm"
        >
          <Logo className="mb-8 lg:hidden" />
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-ink-muted">{subtitle}</p>
          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate={false}>
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
                  className={`${inputClass} mt-1.5 py-2.5`}
                />
                {f.hint && (
                  <p id={`${f.name}-hint`} className="mt-1 text-xs text-ink-muted">
                    {f.hint}
                  </p>
                )}
              </div>
            ))}
            <ErrorText>{error}</ErrorText>
            <Button className="w-full py-2.5" loading={pending} loadingText="Please wait…">
              {submitLabel}
            </Button>
          </form>
          {extra}
          <p className="mt-6 text-center text-sm text-ink-muted">
            <Link href={alt.href} className={linkClass}>
              {alt.text}
            </Link>
          </p>
        </motion.div>
      </main>
    </div>
  );
}
