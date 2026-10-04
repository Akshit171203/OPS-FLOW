import assert from 'node:assert/strict';
import { test } from 'node:test';
import config, { securityHeaders } from '../next.config.mjs';

const asMap = (list) => Object.fromEntries(list.map((h) => [h.key.toLowerCase(), h.value]));

test('every route gets the baseline security headers', async () => {
  const rules = await config.headers();
  assert.equal(rules.length, 1);
  assert.equal(rules[0].source, '/:path*');
  const h = asMap(rules[0].headers);
  assert.equal(h['x-frame-options'], 'DENY');
  assert.equal(h['x-content-type-options'], 'nosniff');
  assert.equal(h['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.match(h['permissions-policy'], /camera=\(\)/);
  assert.equal(h['cross-origin-opener-policy'], 'same-origin');
});

test('production adds a CSP that forbids framing, plugins and foreign origins', () => {
  const csp = asMap(securityHeaders(true))['content-security-policy'];
  assert.ok(csp, 'production must send a Content-Security-Policy');
  for (const directive of [
    "default-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ]) {
    assert.ok(csp.includes(directive), `missing ${directive}`);
  }
  // nothing may be loaded from an arbitrary host
  assert.ok(!/\*/.test(csp), 'CSP must not use a wildcard source');
  assert.ok(!csp.includes('unsafe-eval'), 'production CSP must not allow eval');
});

test('development skips the CSP so hot reload keeps working but still sends the other headers', () => {
  const h = asMap(securityHeaders(false));
  assert.equal(h['content-security-policy'], undefined);
  assert.equal(h['x-frame-options'], 'DENY');
});
