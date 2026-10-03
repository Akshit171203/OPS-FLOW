import type { IncidentStatus, Priority, ServiceStatus, Severity } from '@opsflow/shared';

const base = 'inline-block rounded px-2 py-0.5 text-xs font-medium';

const severityStyle: Record<Severity, string> = {
  SEV1: 'bg-red-100 text-red-800',
  SEV2: 'bg-orange-100 text-orange-800',
  SEV3: 'bg-yellow-100 text-yellow-800',
  SEV4: 'bg-slate-100 text-slate-700',
};
const statusStyle: Record<IncidentStatus, string> = {
  OPEN: 'bg-red-50 text-red-700',
  INVESTIGATING: 'bg-amber-50 text-amber-700',
  MITIGATING: 'bg-blue-50 text-blue-700',
  RESOLVED: 'bg-green-50 text-green-700',
  CLOSED: 'bg-slate-100 text-slate-600',
};
const serviceStyle: Record<ServiceStatus, string> = {
  HEALTHY: 'bg-green-50 text-green-700',
  DEGRADED: 'bg-amber-50 text-amber-700',
  DOWN: 'bg-red-50 text-red-700',
  UNKNOWN: 'bg-slate-100 text-slate-600',
};

export const SeverityBadge = ({ value }: { value: Severity }) => (
  <span className={`${base} ${severityStyle[value]}`}>{value}</span>
);
export const StatusBadge = ({ value }: { value: IncidentStatus }) => (
  <span className={`${base} ${statusStyle[value]}`}>{value}</span>
);
export const ServiceStatusBadge = ({ value }: { value: ServiceStatus }) => (
  <span className={`${base} ${serviceStyle[value]}`}>{value}</span>
);
export const PriorityBadge = ({ value }: { value: Priority }) => (
  <span className={`${base} bg-slate-100 text-slate-700`}>{value}</span>
);

export const inputClass =
  'w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-200';
export const buttonClass =
  'rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60';
export const secondaryButtonClass =
  'rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60';

export const ErrorText = ({ children }: { children?: React.ReactNode }) =>
  children ? (
    <p role="alert" className="text-sm text-red-700">
      {children}
    </p>
  ) : null;

export const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block text-sm font-medium">
    {label}
    <div className="mt-1 font-normal">{children}</div>
  </label>
);
