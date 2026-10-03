/**
 * Remove things that must never reach a third-party model: email addresses and credentials.
 * Applied to every free-text field (logs, descriptions, runbooks). It is deliberately conservative:
 * a false positive costs a few words, a false negative leaks a secret.
 */
const RULES: [RegExp, string][] = [
  // bounded quantifiers: an unbounded local part makes this quadratic on long runs of word characters
  [/\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}/g, '[EMAIL]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[JWT]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]'],
  [
    /\b(?:AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,})\b/g,
    '[API_KEY]',
  ],
  [
    /\b(password|passwd|secret|token|api[_-]?key|authorization|cookie)(["']?\s*[:=]\s*["']?)[^\s"',;]+/gi,
    '$1$2[REDACTED]',
  ],
  [/\b[0-9a-f]{40,}\b/gi, '[HEX]'],
  [/postgres(?:ql)?:\/\/[^\s]+/gi, '[DATABASE_URL]'],
];

/** Free text is bounded before scanning so a huge input can never make redaction slow. */
const MAX_SCAN_CHARS = 20_000;

export function redact(text: string): string {
  const input = text.length > MAX_SCAN_CHARS ? text.slice(0, MAX_SCAN_CHARS) : text;
  return RULES.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), input);
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** Redact first, then cut, so a secret split by the cut can never survive. */
export const clean = (text: string, max: number) => truncate(redact(text), max);
