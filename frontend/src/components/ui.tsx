import type { IncidentStatus, Priority, ServiceStatus, Severity } from '@opsflow/shared';

const pill =
  'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium';

// Class names are written out in full so Tailwind can see them; colours come from the design tokens.
const severityStyle: Record<Severity, string> = {
  SEV1: 'bg-sev1-bg text-sev1-fg',
  SEV2: 'bg-sev2-bg text-sev2-fg',
  SEV3: 'bg-sev3-bg text-sev3-fg',
  SEV4: 'bg-sev4-bg text-sev4-fg',
};
const statusStyle: Record<IncidentStatus, string> = {
  OPEN: 'bg-open-bg text-open-fg',
  INVESTIGATING: 'bg-investigating-bg text-investigating-fg',
  MITIGATING: 'bg-mitigating-bg text-mitigating-fg',
  RESOLVED: 'bg-resolved-bg text-resolved-fg',
  CLOSED: 'bg-closed-bg text-closed-fg',
};
const healthStyle: Record<ServiceStatus, string> = {
  HEALTHY: 'bg-healthy-bg text-healthy-fg',
  DEGRADED: 'bg-degraded-bg text-degraded-fg',
  DOWN: 'bg-down-bg text-down-fg',
  UNKNOWN: 'bg-unknown-bg text-unknown-fg',
};

export const SeverityBadge = ({ value }: { value: Severity }) => (
  <span className={`${pill} ${severityStyle[value]}`}>{value}</span>
);
export const StatusBadge = ({ value }: { value: IncidentStatus }) => (
  <span className={`${pill} ${statusStyle[value]}`}>{value}</span>
);
export const ServiceStatusBadge = ({ value }: { value: ServiceStatus }) => (
  <span className={`${pill} ${healthStyle[value]}`}>{value}</span>
);
export const PriorityBadge = ({ value }: { value: Priority }) => (
  <span className={`${pill} border border-line bg-surface text-ink-muted`}>{value}</span>
);

export const Pill = ({
  className = '',
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => <span className={`${pill} ${className}`}>{children}</span>;

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60';
export const buttonClass = `${buttonBase} bg-accent-600 text-white hover:bg-accent-700`;
export const secondaryButtonClass = `${buttonBase} border border-slate-300 bg-surface text-ink hover:bg-slate-50`;
export const linkClass = 'text-accent-700 underline underline-offset-2 hover:text-accent-800';

export const inputClass =
  'w-full rounded-md border border-slate-300 bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle disabled:bg-slate-100';

export const ErrorText = ({ children }: { children?: React.ReactNode }) =>
  children ? (
    <p role="alert" className="text-sm text-danger-fg">
      {children}
    </p>
  ) : null;

export const Field = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <label className="block text-sm font-medium text-ink">
    {label}
    <div className="mt-1 font-normal">{children}</div>
    {hint && <span className="mt-1 block text-xs font-normal text-ink-muted">{hint}</span>}
  </label>
);

export function Button({
  loading,
  loadingText,
  variant = 'primary',
  className = '',
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  loadingText?: string;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      aria-busy={loading || undefined}
      className={`${variant === 'primary' ? buttonClass : secondaryButtonClass} ${className}`}
    >
      {loading && <Spinner />}
      {loading && loadingText ? loadingText : children}
    </button>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`h-4 w-4 motion-safe:animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
