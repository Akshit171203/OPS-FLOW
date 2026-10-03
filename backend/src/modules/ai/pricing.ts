/**
 * Estimated price in US dollars per one million tokens. These are rough list prices kept in code so
 * they are easy to review and edit; treat the totals as an estimate, not an invoice. Unknown models
 * (and the offline fake) cost nothing.
 */
export const PRICE_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini-embedding-001': { input: 0.15, output: 0 },
};

export function estimateCost(
  model: string | null,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = model ? PRICE_PER_MILLION_TOKENS[model] : undefined;
  if (!price) return 0;
  const dollars = (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  return Math.round(dollars * 1_000_000) / 1_000_000; // 6 decimal places, matching the column
}
