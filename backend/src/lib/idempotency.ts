import { db, type Executor } from '../db/client';
import { idempotencyKeys } from '../db/schema';

export type ProcessOnceResult<T> = { ran: true; result: T } | { ran: false };

/**
 * Runs `fn` at most once per (key, scope). The key is recorded in the SAME transaction as the
 * work `fn` does, so if `fn` throws the key is rolled back and a retry runs again. Recording the
 * key first and committing it separately would turn one failed attempt into a permanently
 * skipped event. Concurrent callers with the same key serialize on the unique index.
 */
export async function processOnce<T>(
  key: string,
  scope: string,
  fn: (tx: Executor) => Promise<T>,
): Promise<ProcessOnceResult<T>> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(idempotencyKeys)
      .values({ key, scope })
      .onConflictDoNothing()
      .returning({ id: idempotencyKeys.id });
    if (inserted.length === 0) return { ran: false };
    return { ran: true, result: await fn(tx) };
  });
}
