import { db } from '../../db/client';
import { AIProviderError, type AIProvider } from '../ai/provider';
import { NotFoundError } from '../../lib/errors';
import { chunkRunbook } from './chunker';
import { runbooksRepository as repo } from './repository';

const EMBED_CONCURRENCY = 4;

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

export interface IndexResult {
  chunks: number;
  /** False when the runbook was edited while indexing; a newer job will index the new text. */
  written: boolean;
}

/**
 * Chunk a runbook, embed every chunk, and replace the stored chunks. Re-indexing is idempotent: it
 * always replaces, never appends. Embedding (slow network calls) happens before the transaction so no
 * database connection is held while waiting for the provider.
 */
export async function indexRunbook(
  organizationId: string,
  runbookId: string,
  provider: AIProvider,
): Promise<IndexResult> {
  const runbook = await repo.find(db, organizationId, runbookId);
  if (!runbook) throw new NotFoundError('Runbook not found', 'RUNBOOK_NOT_FOUND');

  const chunks = chunkRunbook(runbook.title, runbook.content);
  const embedded = await mapLimit(chunks, EMBED_CONCURRENCY, async (chunk) => {
    const e = await provider.generateEmbedding(chunk.content, 'document');
    return { chunkIndex: chunk.index, content: chunk.content, embedding: e.vector };
  });

  const written = await db.transaction((tx) =>
    repo.replaceChunks(
      tx,
      { id: runbook.id, organizationId, updatedAt: runbook.updatedAt },
      embedded,
      provider.embeddingModel,
    ),
  );
  return { chunks: embedded.length, written };
}

/** Record a failure on the runbook so the UI can show why it is not searchable. */
export async function markIndexFailed(runbookId: string, err: unknown) {
  const message =
    err instanceof AIProviderError ? `${err.code}: ${err.message}` : (err as Error).message;
  await repo.setStatus(db, runbookId, 'FAILED', message.slice(0, 500));
}
