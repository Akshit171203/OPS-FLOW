import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { buttonClass, secondaryButtonClass } from './ui';

/** Grey placeholder shown while data loads. Decorative: the surrounding region announces "Loading". */
export const Skeleton = ({ className = '' }: { className?: string }) => (
  <div
    aria-hidden="true"
    className={`skeleton-shimmer rounded-lg bg-skeleton motion-safe:animate-shimmer ${className}`}
  />
);

export const SkeletonLines = ({ lines = 3 }: { lines?: number }) => (
  <div className="space-y-2" aria-hidden="true">
    {Array.from({ length: lines }, (_, i) => (
      <Skeleton key={i} className={`h-4 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
    ))}
  </div>
);

export const LoadingRegion = ({
  label = 'Loading',
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) => (
  <div role="status" aria-live="polite" aria-busy="true">
    <span className="sr-only">{label}…</span>
    {children}
  </div>
);

export function Card({ className = '', children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={`card-surface rounded-xl ${className}`}>
      {children}
    </div>
  );
}

/** A card with a header: a title, an optional one-line description, and an optional action on the right. */
export function Panel({
  title,
  description,
  action,
  children,
  className = '',
  bodyClassName = '',
  headingId,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  headingId?: string;
}) {
  return (
    <section aria-labelledby={headingId} className={`card-surface min-w-0 rounded-xl ${className}`}>
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 id={headingId} className="text-[15px] font-semibold leading-tight text-ink">
            {title}
          </h2>
          {description && <p className="mt-1 text-[13px] text-ink-subtle">{description}</p>}
        </div>
        {action}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function SectionHeading({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-[15px] font-semibold text-ink">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight text-ink">
          {title}
        </h1>
        {description && <p className="mt-1.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
      <p className="font-medium text-ink">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-danger-line bg-danger-bg px-4 py-4">
      <p className="font-medium text-danger-fg">Something went wrong</p>
      <p className="mt-1 text-sm text-danger-fg">{message}</p>
      {onRetry && (
        <button className={`${secondaryButtonClass} mt-3`} onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

const toneValue = {
  default: 'text-ink',
  danger: 'text-sev1-fg',
  warning: 'text-degraded-fg',
  good: 'text-resolved-fg',
} as const;

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: keyof typeof toneValue;
}) {
  return (
    <Card className="p-5">
      <p className="text-[13px] text-ink-muted">{label}</p>
      <p
        className={`mt-2 text-[2rem] font-semibold leading-none tabular-nums tracking-tight ${toneValue[tone]}`}
      >
        {value}
      </p>
      {hint && <p className="mt-2 text-xs text-ink-subtle">{hint}</p>}
    </Card>
  );
}

/** Several figures in one card, divided by hairlines: reads as one summary instead of four boxes. */
export function StatStrip({
  items,
}: {
  items: {
    label: string;
    value: React.ReactNode;
    hint?: React.ReactNode;
    tone?: keyof typeof toneValue;
  }[];
}) {
  return (
    <Card className="grid grid-cols-2 lg:grid-cols-4">
      {items.map((it, i) => (
        <div
          key={it.label}
          className={`p-5 ${i % 2 === 1 ? 'border-l border-line' : ''} ${i >= 2 ? 'border-t border-line lg:border-t-0' : ''} ${i > 0 ? 'lg:border-l lg:border-line' : ''}`}
        >
          <p className="text-[13px] text-ink-muted">{it.label}</p>
          <p
            className={`mt-2 text-[2rem] font-semibold leading-none tabular-nums tracking-tight ${toneValue[it.tone ?? 'default']}`}
          >
            {it.value}
          </p>
          {it.hint && <p className="mt-2 text-xs text-ink-subtle">{it.hint}</p>}
        </div>
      ))}
    </Card>
  );
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <p className="mb-3 text-sm">
      <Link
        href={href}
        className="inline-flex items-center gap-1.5 text-ink-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {children}
      </Link>
    </p>
  );
}

export const PrimaryLinkButton = ({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) => (
  <a href={href} className={buttonClass}>
    {children}
  </a>
);
