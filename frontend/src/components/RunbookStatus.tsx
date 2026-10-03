import type { RunbookIndexStatus } from '@opsflow/shared';
import { Pill, Spinner } from './ui';

export function IndexStatusBadge({ status }: { status: RunbookIndexStatus }) {
  if (status === 'INDEXED') return <Pill className="bg-resolved-bg text-resolved-fg">Indexed</Pill>;
  if (status === 'FAILED') return <Pill className="bg-down-bg text-down-fg">Indexing failed</Pill>;
  return (
    <Pill className="gap-1.5 bg-investigating-bg text-investigating-fg">
      <Spinner className="h-3 w-3" /> Indexing…
    </Pill>
  );
}
