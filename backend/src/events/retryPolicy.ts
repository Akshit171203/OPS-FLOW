import { config } from '../lib/config';

export const MAX_ATTEMPTS = 3;

/**
 * Delay before the next attempt, given how many attempts have failed so far (1-based).
 * With 3 attempts only the first two delays are ever used; a longer list is clamped
 * so raising MAX_ATTEMPTS later cannot index past the end.
 */
export function backoffDelay(
  failedAttempts: number,
  delays: readonly number[] = config.RETRY_DELAYS_MS,
): number {
  const index = Math.min(Math.max(failedAttempts, 1), delays.length) - 1;
  return delays[index]!;
}

export const hasAttemptsLeft = (failedAttempts: number, max = MAX_ATTEMPTS) => failedAttempts < max;
