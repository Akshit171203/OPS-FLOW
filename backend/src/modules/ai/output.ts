import { AnalysisResultSchema, type AnalysisResult } from '@opsflow/shared';

export type ParsedOutput = { ok: true; result: AnalysisResult } | { ok: false; problem: string };

/** Models often wrap JSON in ```json fences or add a sentence around it; peel both off. */
export function extractJson(text: string): string {
  let t = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  if (fenced) t = fenced[1]!.trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  return start !== -1 && end > start ? t.slice(start, end + 1) : t;
}

/**
 * Parse and validate model output. Never trusts it: JSON that parses but has the wrong shape, an
 * out-of-range confidence, or no evidence on a cause is rejected, with a short problem description
 * that can be fed back to the model for one repair attempt.
 */
export function parseAnalysis(text: string): ParsedOutput {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(text));
  } catch (err) {
    return {
      ok: false,
      problem: `the reply was not valid JSON (${(err as Error).message.slice(0, 120)})`,
    };
  }
  const parsed = AnalysisResultSchema.safeParse(json);
  if (parsed.success) return { ok: true, result: parsed.data };
  const problem = parsed.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
    .join('; ');
  return { ok: false, problem: `the JSON did not match the required shape (${problem})` };
}
