import type { ServiceStatus } from '@opsflow/shared';

const color: Record<ServiceStatus, string> = {
  HEALTHY: 'bg-dot-ok',
  DEGRADED: 'bg-dot-warn',
  DOWN: 'bg-dot-bad',
  UNKNOWN: 'bg-dot-idle',
};

/** Coloured dot for a service's health. Decorative: always render the status text beside it. */
export function StatusDot({
  status,
  className = '',
}: {
  status: ServiceStatus;
  className?: string;
}) {
  const live = status === 'DEGRADED' || status === 'DOWN';
  return (
    <span aria-hidden="true" className={`relative inline-flex h-2 w-2 shrink-0 ${className}`}>
      {live && (
        <span
          className={`absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping-slow ${color[status]}`}
        />
      )}
      <span className={`relative h-2 w-2 rounded-full ${color[status]}`} />
    </span>
  );
}
