// Fails if any design-token text/background pair is below WCAG AA (4.5:1 for normal text), in BOTH themes.
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');
const block = (start) => {
  const from = css.indexOf(start);
  return css.slice(from, css.indexOf('\n}', from));
};
const parse = (text) =>
  Object.fromEntries(
    [...text.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]),
  );
const light = parse(block('@theme {'));
const themes = { light, dark: { ...light, ...parse(block('.dark {')) } };

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

let failed = 0;
let total = 0;
for (const [name, tokens] of Object.entries(themes)) {
  // every *-bg has a matching *-fg
  const pairs = Object.keys(tokens)
    .filter((k) => k.endsWith('-bg'))
    .map((k) => [`${k.slice(0, -3)}-fg`, k]);
  // text on the surfaces it is used on, and the accent link / button combinations
  for (const surface of ['canvas', 'surface', 'surface-2']) {
    for (const ink of ['ink', 'ink-muted', 'ink-subtle', 'accent-ink']) pairs.push([ink, surface]);
  }
  pairs.push(['accent-ink', 'accent-soft'], ['ink', 'accent-soft']);
  const results = pairs.map(([fg, bg]) => ({
    fg,
    bg,
    ratio: tokens[fg] && tokens[bg] ? ratio(tokens[fg], tokens[bg]) : NaN,
  }));
  results.push({ fg: 'white', bg: 'accent-600', ratio: ratio('#ffffff', tokens['accent-600']) });
  results.push({ fg: 'white', bg: 'accent-700', ratio: ratio('#ffffff', tokens['accent-700']) });

  console.log(`\n${name} theme`);
  for (const r of results) {
    total += 1;
    const ok = r.ratio >= 4.5;
    if (!ok) failed += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${r.ratio.toFixed(2).padStart(5)}  ${r.fg} on ${r.bg}`);
  }
}
console.log(failed ? `\n${failed} pair(s) below 4.5:1` : `\nall ${total} pairs meet WCAG AA`);
process.exit(failed ? 1 : 0);
