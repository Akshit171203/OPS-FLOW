import { buttonClass, secondaryButtonClass } from './ui';

/** Grey placeholder shown while data loads. Decorative: the surrounding region announces "Loading". */
export const Skeleton = ({ className = '' }: { className?: string }) => (
  <div
    aria-hidden="true"
    className={`rounded-md bg-slate-200 motion-safe:animate-pulse ${className}`}
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
    <div {...rest} className={`rounded-lg border border-line bg-surface shadow-sm ${className}`}>
      {children}
    </div>
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
      <h2 className="text-base font-semibold text-ink">{children}</h2>
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
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
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
    <div className="rounded-lg border border-dashed border-slate-300 bg-surface px-6 py-10 text-center">
      <p className="font-medium text-ink">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-danger-line bg-danger-bg px-4 py-4">
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

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'default' | 'danger' | 'warning';
}) {
  const accent =
    tone === 'danger' ? 'text-sev1-fg' : tone === 'warning' ? 'text-degraded-fg' : 'text-ink';
  return (
    <Card className="p-4">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className={`mt-1 text-3xl font-semibold tabular-nums ${accent}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-subtle">{hint}</p>}
    </Card>
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
