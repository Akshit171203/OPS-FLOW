import { Check } from 'lucide-react';
import { incidentStatuses, type IncidentStatus } from '@opsflow/shared';

/** Where the incident is in its lifecycle: finished steps, the current one, and what is left. */
export function LifecycleStepper({
  status,
  wrap = false,
}: {
  status: IncidentStatus;
  wrap?: boolean;
}) {
  const current = incidentStatuses.indexOf(status);
  return (
    <ol
      aria-label="Incident lifecycle"
      className={`flex items-center gap-1 ${wrap ? 'flex-wrap gap-y-2' : 'overflow-x-auto pb-1'}`}
    >
      {incidentStatuses.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={s}
            aria-current={active ? 'step' : undefined}
            className="flex items-center gap-1"
          >
            <span
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                active
                  ? 'bg-accent-600 text-white ring-transparent'
                  : done
                    ? 'bg-resolved-bg text-resolved-fg ring-resolved-fg/20'
                    : 'text-ink-subtle ring-line'
              }`}
            >
              {done ? (
                <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
              ) : (
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-white' : 'bg-current opacity-50'}`}
                />
              )}
              {s.charAt(0) + s.slice(1).toLowerCase()}
              <span className="sr-only">
                {done ? ' (done)' : active ? ' (current)' : ' (not reached)'}
              </span>
            </span>
            {i < incidentStatuses.length - 1 && (
              <span
                aria-hidden="true"
                className={`h-px w-4 ${i < current ? 'bg-resolved-fg/50' : 'bg-line-strong'}`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
