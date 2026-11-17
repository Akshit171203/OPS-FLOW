import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The styled dropdown must post its REAL value in forms. Radix's own form field submits an internal
// placeholder for "no selection" ("__none__"), which the API rejects (it broke API key creation and the
// new incident form once). So the component renders its own hidden input and never hands `name` to Radix.
const src = readFileSync(new URL('../src/components/Select.tsx', import.meta.url), 'utf8');

test('the component submits its own hidden input with the real value', () => {
  assert.match(src, /<input type="hidden" name=\{name\} value=\{current\} \/>/);
});

test('the name is not passed to the Radix root, whose form field would submit the placeholder', () => {
  const root = src.slice(src.indexOf('<RS.Root'), src.indexOf('>', src.indexOf('<RS.Root')));
  assert.doesNotMatch(root, /\bname=/);
  assert.doesNotMatch(root, /\brequired=/);
});

test('"no selection" maps to an empty string on the way out', () => {
  assert.match(src, /const fromRadix = \(v: string\) => \(v === NONE \? '' : v\);/);
});
