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

export function SectionHeading({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-subtle">{children}</h2>
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
        <h1 className="text-[1.65rem] font-semibold leading-tight tracking-tight text-ink">
          {title}
        </h1>
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
    <div className="rounded-xl border border-dashed border-line-strong bg-surface/60 px-6 py-12 text-center backdrop-blur">
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

const toneStyles = {
  default: { value: 'text-ink', chip: 'bg-surface-2 text-ink-muted', glow: '' },
  danger: {
    value: 'text-sev1-fg',
    chip: 'bg-sev1-bg text-sev1-fg',
    glow: 'before:bg-[radial-gradient(18rem_8rem_at_100%_0%,rgb(244_63_94/0.14),transparent_70%)]',
  },
  warning: {
    value: 'text-degraded-fg',
    chip: 'bg-degraded-bg text-degraded-fg',
    glow: 'before:bg-[radial-gradient(18rem_8rem_at_100%_0%,rgb(245_158_11/0.14),transparent_70%)]',
  },
  good: {
    value: 'text-resolved-fg',
    chip: 'bg-resolved-bg text-resolved-fg',
    glow: 'before:bg-[radial-gradient(18rem_8rem_at_100%_0%,rgb(16_185_129/0.14),transparent_70%)]',
  },
} as const;

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: keyof typeof toneStyles;
}) {
  const t = toneStyles[tone];
  return (
    <Card
      className={`relative overflow-hidden p-4 before:pointer-events-none before:absolute before:inset-0 ${t.glow}`}
    >
      <div className="relative flex items-start justify-between gap-2">
        <p className="text-sm text-ink-muted">{label}</p>
        {icon && (
          <span
            aria-hidden="true"
            className={`grid h-8 w-8 place-items-center rounded-lg ${t.chip}`}
          >
            {icon}
          </span>
        )}
      </div>
      <p className={`relative mt-2 text-[2rem] font-semibold leading-none tabular-nums ${t.value}`}>
        {value}
      </p>
      {hint && <p className="relative mt-2 text-xs text-ink-subtle">{hint}</p>}
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
