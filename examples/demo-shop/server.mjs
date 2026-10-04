#!/usr/bin/env node
/**
 * A tiny "shop" website that talks to OpsFlow exactly like a real service would:
 *   - reports each deployment,
 *   - ships its logs and metrics,
 *   - and raises an alert when its error rate spikes.
 * It also generates its own traffic, so everything is live with no extra setup.
 *
 *   node examples/demo-shop/server.mjs                 start the healthy v1.0.0 shop
 *   curl -X POST localhost:5050/admin/deploy-bad       deploy v1.1.0, which leaks database connections
 *   curl -X POST localhost:5050/admin/rollback         roll back to a healthy version
 *
 * No dependencies: Node 22 only. See examples/demo-shop/README.md.
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const cfg = {
  url: (process.env.OPSFLOW_URL ?? 'http://localhost:3140').replace(/\/$/, ''),
  key: process.env.OPSFLOW_API_KEY ?? '',
  service: process.env.OPSFLOW_SERVICE ?? 'shop-service',
  port: Number(process.env.PORT ?? 5050),
  traffic: process.env.TRAFFIC !== '0',
  demoEmail: process.env.OPSFLOW_DEMO_EMAIL ?? 'demo-admin@opsflow.demo',
  demoPassword: process.env.OPSFLOW_DEMO_PASSWORD ?? 'demo-password-1',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (msg) => console.log(`[shop ${new Date().toLocaleTimeString()}] ${msg}`);

// ---------------------------------------------------------------- talking to OpsFlow
async function opsflow(path, body) {
  if (!cfg.key) return null;
  try {
    const res = await fetch(`${cfg.url}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) say(`OpsFlow rejected ${path}: ${res.status} ${json?.error?.message ?? ''}`);
    return res.ok ? json : null;
  } catch (err) {
    // The shop must never fail because monitoring is down
    say(`could not reach OpsFlow (${err.message}); carrying on`);
    return null;
  }
}

/** First-run convenience for local demos: sign in as the seeded demo admin and mint a key for this shop. */
async function bootstrapKey() {
  const login = await fetch(`${cfg.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: cfg.demoEmail, password: cfg.demoPassword }),
  });
  if (!login.ok)
    throw new Error(
      `could not sign in as ${cfg.demoEmail} (${login.status}). Run "pnpm db:seed" first, or set OPSFLOW_API_KEY`,
    );
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const call = async (path, init = {}) => {
    const res = await fetch(`${cfg.url}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', 'x-requested-with': 'opsflow', cookie },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${path} -> ${res.status} ${json?.error?.message ?? ''}`);
    return json;
  };
  const projects = (await call('/api/projects?limit=100')).items;
  const project =
    projects.find((p) => p.slug === 'platform') ??
    projects[0] ??
    (
      await call('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name: 'Platform', slug: 'platform' }),
      })
    ).project;
  const services = (await call('/api/services?limit=100')).items;
  const service =
    services.find((s) => s.slug === cfg.service) ??
    (
      await call('/api/services', {
        method: 'POST',
        body: JSON.stringify({ projectId: project.id, name: 'Shop Service', slug: cfg.service }),
      })
    ).service;
  // keep things tidy: retire earlier keys made by this script
  for (const k of (await call('/api/api-keys')).keys) {
    if (k.name === 'demo-shop' && !k.revokedAt)
      await call(`/api/api-keys/${k.id}`, { method: 'DELETE' });
  }
  const created = await call('/api/api-keys', {
    method: 'POST',
    body: JSON.stringify({
      name: 'demo-shop',
      scopes: ['ingest', 'alerts'],
      serviceId: service.id,
    }),
  });
  return created.key.key;
}

// ---------------------------------------------------------------- the "database" with a small connection pool
const pool = { max: 5, active: 0, waiting: [] };
const shop = { version: 'v1.0.0', leaking: false };

function acquire() {
  return new Promise((resolve, reject) => {
    if (pool.active < pool.max) {
      pool.active += 1;
      return resolve();
    }
    const waiter = { resolve };
    waiter.timer = setTimeout(() => {
      pool.waiting.splice(pool.waiting.indexOf(waiter), 1);
      reject(new Error('timeout'));
    }, 400);
    pool.waiting.push(waiter);
  });
}
function release() {
  const next = pool.waiting.shift();
  if (next) {
    clearTimeout(next.timer);
    next.resolve();
  } else pool.active = Math.max(0, pool.active - 1);
}
function resetPool() {
  for (const w of pool.waiting) clearTimeout(w.timer);
  pool.waiting = [];
  pool.active = 0;
}

// ---------------------------------------------------------------- telemetry buffers
const requests = []; // { t, ok, ms }
const logBuffer = [];
function log(level, message, requestId) {
  logBuffer.push({
    service: cfg.service,
    level,
    message,
    requestId,
    timestamp: new Date().toISOString(),
  });
}

async function flushLogs() {
  if (logBuffer.length === 0) return;
  const batch = logBuffer.splice(0, 200);
  await opsflow('/api/logs', { logs: batch });
}

async function sendMetrics() {
  const windowMs = 10_000;
  const recent = requests.filter((r) => r.t > Date.now() - windowMs);
  if (recent.length === 0) return;
  const failed = recent.filter((r) => !r.ok).length;
  const sorted = recent.map((r) => r.ms).sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  await opsflow('/api/metrics', {
    service: cfg.service,
    errorRate: Number((failed / recent.length).toFixed(4)),
    latencyMs: Math.round(p95),
    requestsPerMin: Math.round((recent.length * 60_000) / windowMs),
  });
}

// ---------------------------------------------------------------- a simple alert rule, like a monitoring tool would run
const alert = { firing: false, calm: 0, lastSent: 0 };
async function evaluateAlert() {
  const recent = requests.filter((r) => r.t > Date.now() - 20_000);
  if (recent.length < 20) return;
  const rate = recent.filter((r) => !r.ok).length / recent.length;
  const base = {
    service: cfg.service,
    source: 'demo-shop',
    fingerprint: 'shop-checkout-errors',
    title: 'Checkout is failing: error rate above 20%',
  };
  if (rate > 0.2) {
    alert.calm = 0;
    if (!alert.firing || Date.now() - alert.lastSent > 60_000) {
      // set the state first: the call below can outlast the 5s evaluation interval, and a second evaluation must not re-fire
      alert.firing = true;
      alert.lastSent = Date.now();
      const r = await opsflow('/api/integrations/alerts', {
        ...base,
        severity: 'critical',
        status: 'firing',
        description: `${(rate * 100).toFixed(0)}% of checkout requests failed in the last 20 seconds on ${shop.version}.`,
      });
      if (r) say(`ALERT firing -> OpsFlow: incident ${r.action} (${r.incidentId})`);
    }
  } else if (alert.firing && rate < 0.05 && ++alert.calm >= 2) {
    const r = await opsflow('/api/integrations/alerts', { ...base, status: 'resolved' });
    if (r) say(`alert resolved -> OpsFlow: ${r.action}`);
    alert.firing = false;
  }
}

// ---------------------------------------------------------------- the shop itself
async function checkout(res) {
  const started = Date.now();
  const requestId = `req-${randomUUID().slice(0, 8)}`;
  let ok = true;
  try {
    await acquire();
    await sleep(30 + Math.random() * 50); // the "query"
    // v1.1.0 forgets to release the connection about half the time: a classic connection leak
    if (!(shop.leaking && Math.random() < 0.5)) release();
    if (Math.random() < 0.04)
      log('INFO', `Order completed in ${Date.now() - started}ms`, requestId);
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ ok: true, requestId }));
  } catch {
    ok = false;
    log(
      'ERROR',
      `Connection pool exhausted: active=${pool.active} max=${pool.max} waiting=${pool.waiting.length}`,
      requestId,
    );
    log(
      'ERROR',
      `Payment authorization failed for request ${requestId}: upstream timeout`,
      requestId,
    );
    res
      .writeHead(500, { 'content-type': 'application/json' })
      .end(JSON.stringify({ ok: false, error: 'service unavailable' }));
  }
  const ms = Date.now() - started;
  if (ok && ms > 250) log('WARN', `Slow request: /checkout took ${ms}ms`, requestId);
  requests.push({ t: Date.now(), ok, ms });
  if (requests.length > 5000) requests.splice(0, 2500);
}

async function deploy(version, leaking, deployedBy, status = 'SUCCESS') {
  shop.version = version;
  shop.leaking = leaking;
  resetPool();
  log('INFO', `Deployment ${version} rolled out${leaking ? '' : ' (healthy)'}`);
  await opsflow('/api/deployments', {
    service: cfg.service,
    version,
    commitSha: randomUUID().replace(/-/g, '').slice(0, 7),
    environment: 'production',
    deployedBy,
    status,
  });
  say(`deployed ${version} (reported to OpsFlow)`);
}

const server = http.createServer(async (req, res) => {
  const route = `${req.method} ${req.url?.split('?')[0]}`;
  if (route === 'GET /checkout') return checkout(res);
  if (route === 'GET /status') {
    return res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        version: shop.version,
        leaking: shop.leaking,
        pool: { max: pool.max, active: pool.active, waiting: pool.waiting.length },
      }),
    );
  }
  if (route === 'POST /admin/deploy-bad') {
    await deploy('v1.1.0', true, 'ci-pipeline');
    return res
      .writeHead(200)
      .end(
        'Deployed v1.1.0 (it leaks database connections). Watch the shop fail, and OpsFlow open an incident.\n',
      );
  }
  if (route === 'POST /admin/rollback') {
    await deploy('v1.0.1', false, 'on-call-engineer');
    return res.writeHead(200).end('Rolled back to a healthy version.\n');
  }
  res
    .writeHead(200, { 'content-type': 'text/plain' })
    .end(
      `OpsFlow demo shop ${shop.version}\n  GET  /checkout\n  GET  /status\n  POST /admin/deploy-bad\n  POST /admin/rollback\n`,
    );
});

// ---------------------------------------------------------------- start
async function main() {
  if (!cfg.key) {
    try {
      say(`no OPSFLOW_API_KEY set: creating a demo key through ${cfg.url} ...`);
      cfg.key = await bootstrapKey();
      say(
        'demo key created (tied to the shop service). It is not saved; the next run makes a fresh one.',
      );
    } catch (err) {
      say(`${err.message}`);
      say('Running without OpsFlow reporting. Set OPSFLOW_API_KEY (and OPSFLOW_URL) to connect.');
    }
  }
  await new Promise((resolve) => server.listen(cfg.port, resolve));
  say(
    `shop is up on http://localhost:${cfg.port}   reporting to ${cfg.key ? cfg.url : 'nobody'} as "${cfg.service}"`,
  );
  say(
    `crash it:  curl -X POST localhost:${cfg.port}/admin/deploy-bad      fix it:  curl -X POST localhost:${cfg.port}/admin/rollback`,
  );

  await deploy('v1.0.0', false, 'ci-pipeline');
  setInterval(flushLogs, 2000);
  setInterval(sendMetrics, 10_000);
  setInterval(() => void evaluateAlert(), 5000);
  if (cfg.traffic) {
    setInterval(
      () =>
        http
          .get(`http://127.0.0.1:${cfg.port}/checkout`, (r) => r.resume())
          .on('error', () => undefined),
      120,
    );
    say('generating shop traffic (~8 requests/second)');
  }
}

process.on('SIGINT', async () => {
  await flushLogs();
  process.exit(0);
});
main();
