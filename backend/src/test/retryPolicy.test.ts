import { describe, expect, it } from 'vitest';
import { backoffDelay, hasAttemptsLeft, MAX_ATTEMPTS } from '../events/retryPolicy';

const delays = [1000, 5000, 30000];

describe('retry policy', () => {
  it('backs off 1s, then 5s, then 30s after each failed attempt', () => {
    expect(backoffDelay(1, delays)).toBe(1000);
    expect(backoffDelay(2, delays)).toBe(5000);
    expect(backoffDelay(3, delays)).toBe(30000);
  });

  it('clamps beyond the configured delays and below 1', () => {
    expect(backoffDelay(9, delays)).toBe(30000);
    expect(backoffDelay(0, delays)).toBe(1000);
  });

  it('allows exactly MAX_ATTEMPTS attempts', () => {
    expect(MAX_ATTEMPTS).toBe(3);
    expect(hasAttemptsLeft(1)).toBe(true);
    expect(hasAttemptsLeft(2)).toBe(true);
    expect(hasAttemptsLeft(3)).toBe(false);
  });
});
