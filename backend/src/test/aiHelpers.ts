import { expect } from 'vitest';
import type { Express } from 'express';
import { eq } from 'drizzle-orm';
import type { Worker } from 'bullmq';
import { db } from '../db/client';
import { aiAnalyses, runbookChunks, runbooks } from '../db/schema';
import { allQueues } from '../events/queues';
import { FakeProvider } from '../modules/ai/fake';
import { indexRunbook } from '../modules/runbooks/indexer';
import { createIncident, type TestOrg } from './helpers';
import request from './request';
import { waitFor } from './helpers';

export async function resetQueues() {
  for (const { queue } of allQueues()) await queue.obliterate({ force: true });
}

const MINUTE = 60_000;

/** An incident on the org's service with the evidence a real outage leaves: pool errors, a recent deployment, degraded metrics. */
export async function incidentWithEvidence(
  app: Express,
  o: TestOrg,
  over: Record<string, unknown> = {},
) {
  const incident = await createIncident(app, o.engineer, o.serviceId, {
    title: 'Payment failures after rollout',
    severity: 'SEV1',
    ...over,
  });
  const now = Date.now();
  const logs = Array.from({ length: 20 }, (_, i) => ({
    serviceId: o.serviceId,
    incidentId: incident.id,
    level: 'ERROR',
    message: `Connection pool exhausted: active=50 max=50 waiting=${10 + i}`,
    timestamp: new Date(now - (20 - i) * 30_000).toISOString(),
  }));
  const res = await request(app).post('/api/logs').set('cookie', o.engineer).send({ logs });
  expect(res.status).toBe(201);
  await request(app)
    .post('/api/deployments')
    .set('cookie', o.engineer)
    .send({
      serviceId: o.serviceId,
      version: 'v2.4.0',
      commitSha: 'a1b2c3d4e5f6',
      deployedAt: new Date(now - 15 * MINUTE).toISOString(),
    });
  await request(app)
    .post('/api/metrics')
    .set('cookie', o.engineer)
    .send({ serviceId: o.serviceId, errorRate: 0.34, latencyMs: 5200, requestsPerMin: 410 });
  return incident;
}

/** Create a runbook through the API and index it right away with the fake provider. */
export async function indexedRunbook(
  app: Express,
  o: TestOrg,
  title: string,
  content: string,
  provider = new FakeProvider(),
) {
  const res = await request(app)
    .post('/api/runbooks')
    .set('cookie', o.admin)
    .send({ title, content });
  expect(res.status).toBe(201);
  const orgId = (await request(app).get('/api/auth/me').set('cookie', o.admin)).body.organization
    .id;
  await indexRunbook(orgId, res.body.runbook.id, provider);
  return res.body.runbook.id as string;
}

export const PAYMENT_RUNBOOK = `# Payment troubleshooting

## Connection pool exhaustion
When the logs show "Connection pool exhausted" the payment service cannot get a database connection. Check recent deployments, long running queries and the pool size. Rolling back the release requires human approval.

## Other symptoms
Checkout failures and authorization timeouts follow when the connection pool is exhausted.`;

export const AUTH_RUNBOOK = `# Authentication failures

## Login errors
Users cannot sign in and receive 401 responses. Check the token signing secret, the session lifetime and the login rate limit. A rotated secret signs every user out.`;

export async function waitForAnalysis(id: string, status: string | string[], timeoutMs = 8000) {
  const wanted = Array.isArray(status) ? status : [status];
  return waitFor(async () => {
    const [row] = await db.select().from(aiAnalyses).where(eq(aiAnalyses.id, id));
    return row && wanted.includes(row.status) ? row : null;
  }, timeoutMs);
}

export const countChunks = async (runbookId: string) =>
  (await db.select().from(runbookChunks).where(eq(runbookChunks.runbookId, runbookId))).length;
export const runbookRow = async (id: string) =>
  (await db.select().from(runbooks).where(eq(runbooks.id, id)))[0]!;

export async function closeAll(workers: Worker[]) {
  await Promise.all(workers.map((w) => w.close()));
  workers.length = 0;
}
