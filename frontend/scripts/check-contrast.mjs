// Fails if any design-token text/background pair is below WCAG AA (4.5:1 for normal text).
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');
const tokens = Object.fromEntries(
  [...css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]),
);

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// every *-bg has a matching *-fg
const pairs = Object.keys(tokens)
  .filter((k) => k.endsWith('-bg'))
  .map((k) => [`${k.slice(0, -3)}-fg`, k]);
// text on the surfaces it is used on, and the accent button / link / active nav combinations
pairs.push(
  ['ink', 'canvas'],
  ['ink', 'surface'],
  ['ink-muted', 'canvas'],
  ['ink-muted', 'surface'],
  ['ink-subtle', 'surface'],
  ['ink-subtle', 'canvas'],
);
pairs.push(
  ['accent-700', 'surface'],
  ['accent-700', 'canvas'],
  ['accent-800', 'accent-50'],
  ['accent-800', 'accent-100'],
);
const white = { surface: '#ffffff' };
const results = [];
for (const [fg, bg] of pairs) {
  if (!tokens[fg] || !tokens[bg]) {
    results.push({ fg, bg, ratio: NaN, ok: false });
    continue;
  }
  results.push({ fg, bg, ratio: ratio(tokens[fg], tokens[bg]) });
}
results.push({ fg: 'white', bg: 'accent-600', ratio: ratio(white.surface, tokens['accent-600']) });
results.push({ fg: 'white', bg: 'accent-700', ratio: ratio(white.surface, tokens['accent-700']) });

let failed = 0;
for (const r of results) {
  const ok = r.ratio >= 4.5;
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${r.ratio.toFixed(2).padStart(5)}  ${r.fg} on ${r.bg}`);
}
console.log(
  failed ? `\n${failed} pair(s) below 4.5:1` : `\nall ${results.length} pairs meet WCAG AA`,
);
process.exit(failed ? 1 : 0);
