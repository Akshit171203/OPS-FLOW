import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { Worker } from 'bullmq';
import request from './request';
import { buildApp } from '../app';
import { db, pool } from '../db/client';
import { runbookChunks } from '../db/schema';
import { FakeProvider } from '../modules/ai/fake';
import { AIProviderError, UnconfiguredProvider } from '../modules/ai/provider';
import { gatherEvidence, retrieveRunbooks } from '../modules/ai/context/gather';
import { indexRunbook } from '../modules/runbooks/indexer';
import { runbooksRepository } from '../modules/runbooks/repository';
import { createRunbookWorker } from '../workers/runbookWorker';
import {
  AUTH_RUNBOOK,
  PAYMENT_RUNBOOK,
  closeAll,
  countChunks,
  incidentWithEvidence,
  indexedRunbook,
  resetQueues,
  runbookRow,
} from './aiHelpers';
import { resetDb, setupOrg, waitFor, type TestOrg } from './helpers';

const app = buildApp();
const workers: Worker[] = [];
let o: TestOrg;
let orgId: string;

afterAll(() => pool.end());
beforeEach(async () => {
  await resetQueues();
  await resetDb();
  o = await setupOrg(app);
  orgId = (await request(app).get('/api/auth/me').set('cookie', o.admin)).body.organization.id;
});
afterEach(() => closeAll(workers));

const as = (cookie: string) => ({
  get: (url: string) => request(app).get(url).set('cookie', cookie),
  post: (url: string, body: object = {}) => request(app).post(url).set('cookie', cookie).send(body),
  patch: (url: string, body: object) => request(app).patch(url).set('cookie', cookie).send(body),
});

describe('runbook API', () => {
  it('ADMIN+ creates a runbook (PENDING), everyone in the org can read it, VIEWER cannot create', async () => {
    const created = await as(o.admin).post('/api/runbooks', {
      title: 'DB issues',
      content: PAYMENT_RUNBOOK,
      serviceTag: 'payment-service',
    });
    expect(created.status).toBe(201);
    expect(created.body.runbook).toMatchObject({
      title: 'DB issues',
      indexStatus: 'PENDING',
      chunkCount: 0,
      serviceTag: 'payment-service',
    });
    expect(created.body.runbook.content).toBeUndefined(); // list-style payload stays small

    expect((await as(o.viewer).post('/api/runbooks', { title: 'x', content: 'y' })).status).toBe(
      403,
    );
    expect((await as(o.engineer).post('/api/runbooks', { title: 'x', content: 'y' })).status).toBe(
      403,
    );
    const list = await as(o.viewer).get('/api/runbooks');
    expect(list.body).toMatchObject({ total: 1, page: 1 });
    const one = await as(o.viewer).get(`/api/runbooks/${created.body.runbook.id}`);
    expect(one.body.runbook.content).toContain('Connection pool exhaustion');
  });

  it('validates input and scopes everything to the organization', async () => {
    expect((await as(o.admin).post('/api/runbooks', { title: '', content: 'x' })).status).toBe(400);
    expect(
      (await as(o.admin).post('/api/runbooks', { title: 'x', content: 'a'.repeat(50_001) })).status,
    ).toBe(400); // over the schema's size limit
    const other = await setupOrg(app, 'b');
    const id = (
      await as(o.admin).post('/api/runbooks', { title: 'Mine', content: PAYMENT_RUNBOOK })
    ).body.runbook.id;
    expect((await as(other.owner).get(`/api/runbooks/${id}`)).status).toBe(404);
    expect((await as(other.admin).patch(`/api/runbooks/${id}`, { title: 'hax' })).status).toBe(404);
    expect((await as(other.owner).get('/api/runbooks')).body.total).toBe(0);
  });
});

describe('runbook list', () => {
  it('reports the real number of indexed sections for each runbook, not zero', async () => {
    const a = await indexedRunbook(app, o, 'Payment', PAYMENT_RUNBOOK);
    const b = await indexedRunbook(app, o, 'Auth', AUTH_RUNBOOK);
    const pending = (
      await as(o.admin).post('/api/runbooks', { title: 'Not indexed yet', content: AUTH_RUNBOOK })
    ).body.runbook.id;
    const list = (await as(o.viewer).get('/api/runbooks')).body.items as {
      id: string;
      chunkCount: number;
      indexStatus: string;
    }[];
    const byId = Object.fromEntries(list.map((r) => [r.id, r]));
    expect(byId[a]!.chunkCount).toBe(await countChunks(a));
    expect(byId[a]!.chunkCount).toBeGreaterThan(0);
    expect(byId[b]!.chunkCount).toBe(await countChunks(b));
    expect(byId[pending]).toMatchObject({ chunkCount: 0, indexStatus: 'PENDING' });
  });
});

describe('indexing worker', () => {
  it('chunks, embeds and stores a new runbook, ending INDEXED with a chunk count', async () => {
    workers.push(createRunbookWorker({ provider: new FakeProvider() }));
    const id = (
      await as(o.admin).post('/api/runbooks', { title: 'Payment', content: PAYMENT_RUNBOOK })
    ).body.runbook.id;
    const row = await waitFor(async () => {
      const r = await runbookRow(id);
      return r.indexStatus === 'INDEXED' ? r : null;
    });
    expect(row.indexedAt).not.toBeNull();
    const chunks = await countChunks(id);
    expect(chunks).toBeGreaterThanOrEqual(2);
    expect((await as(o.viewer).get(`/api/runbooks/${id}`)).body.runbook).toMatchObject({
      indexStatus: 'INDEXED',
      chunkCount: chunks,
    });
    const models = await db
      .select({ m: runbookChunks.embeddingModel })
      .from(runbookChunks)
      .where(eq(runbookChunks.runbookId, id));
    expect(new Set(models.map((x) => x.m))).toEqual(new Set(['fake-hash-768']));
  });

  it('re-indexing replaces the old chunks: no duplicates, new text searchable', async () => {
    workers.push(createRunbookWorker({ provider: new FakeProvider() }));
    const id = (await as(o.admin).post('/api/runbooks', { title: 'Doc', content: PAYMENT_RUNBOOK }))
      .body.runbook.id;
    await waitFor(async () => (await runbookRow(id)).indexStatus === 'INDEXED');
    const before = await countChunks(id);

    const edited = await as(o.admin).patch(`/api/runbooks/${id}`, { content: AUTH_RUNBOOK });
    expect(edited.body.runbook.indexStatus).toBe('PENDING');
    await waitFor(async () => {
      const r = await runbookRow(id);
      return r.indexStatus === 'INDEXED' && r.content === AUTH_RUNBOOK;
    });
    const rows = await db.select().from(runbookChunks).where(eq(runbookChunks.runbookId, id));
    expect(rows.length).toBeLessThan(before + 1);
    expect(rows.every((r) => !r.content.includes('Connection pool'))).toBe(true); // old content gone
    expect(new Set(rows.map((r) => r.chunkIndex)).size).toBe(rows.length); // no duplicate indexes
  });

  it('re-indexing the same text twice leaves exactly one set of chunks', async () => {
    const id = await indexedRunbook(app, o, 'Doc', PAYMENT_RUNBOOK);
    const n = await countChunks(id);
    const provider = new FakeProvider();
    await indexRunbook(orgId, id, provider);
    await indexRunbook(orgId, id, provider);
    expect(await countChunks(id)).toBe(n);
  });

  it('an edit made while indexing is in flight is not overwritten by the stale job', async () => {
    const created = await as(o.admin).post('/api/runbooks', {
      title: 'Race',
      content: PAYMENT_RUNBOOK,
    });
    const id = created.body.runbook.id;
    const slow = new FakeProvider({
      embed: async (text) => {
        await new Promise((r) => setTimeout(r, 40));
        return (await new FakeProvider().generateEmbedding(text)).vector;
      },
    });
    const indexing = indexRunbook(orgId, id, slow); // reads the old text, then waits on slow embeddings
    await new Promise((r) => setTimeout(r, 30));
    await as(o.admin).patch(`/api/runbooks/${id}`, { content: AUTH_RUNBOOK });
    const result = await indexing;
    expect(result.written).toBe(false); // stale job refused to write
    const row = await runbookRow(id);
    expect(row.indexStatus).toBe('PENDING'); // still waiting for the job for the NEW text
    expect(await countChunks(id)).toBe(0);
  });

  it('reindex-all re-queues every runbook (for example after switching provider)', async () => {
    workers.push(createRunbookWorker({ provider: new FakeProvider() }));
    const a = (await as(o.admin).post('/api/runbooks', { title: 'A', content: PAYMENT_RUNBOOK }))
      .body.runbook.id;
    const b = (await as(o.admin).post('/api/runbooks', { title: 'B', content: AUTH_RUNBOOK })).body
      .runbook.id;
    await waitFor(
      async () =>
        (await runbookRow(a)).indexStatus === 'INDEXED' &&
        (await runbookRow(b)).indexStatus === 'INDEXED',
    );
    const res = await as(o.admin).post('/api/runbooks/reindex-all');
    expect(res.status).toBe(202);
    expect(res.body.queued).toBe(2);
    expect((await as(o.engineer).post('/api/runbooks/reindex-all')).status).toBe(403);
    await waitFor(
      async () =>
        (await runbookRow(a)).indexStatus === 'INDEXED' &&
        (await runbookRow(b)).indexStatus === 'INDEXED',
    );
  });

  it('a provider that is not configured marks the runbook FAILED with a reason; the rest of the API is unaffected', async () => {
    workers.push(
      createRunbookWorker({ provider: new UnconfiguredProvider('GEMINI_API_KEY is not set') }),
    );
    const id = (
      await as(o.admin).post('/api/runbooks', { title: 'Unindexable', content: PAYMENT_RUNBOOK })
    ).body.runbook.id;
    const row = await waitFor(async () => {
      const r = await runbookRow(id);
      return r.indexStatus === 'FAILED' ? r : null;
    });
    expect(row.indexError).toMatch(/AI_NOT_CONFIGURED/);
    expect((await as(o.viewer).get(`/api/runbooks/${id}`)).body.runbook).toMatchObject({
      indexStatus: 'FAILED',
      chunkCount: 0,
    });
    for (const url of [
      '/api/incidents',
      '/api/services',
      '/api/dashboard',
      '/api/logs',
      '/api/notifications',
    ]) {
      expect((await as(o.viewer).get(url)).status).toBe(200);
    }
  });

  it('retries a transient provider error and succeeds', async () => {
    let calls = 0;
    workers.push(
      createRunbookWorker({
        provider: new FakeProvider({
          embed: async (text) => {
            calls += 1;
            if (calls <= 1) throw new AIProviderError('AI_RATE_LIMITED', 'slow down', true);
            return (await new FakeProvider().generateEmbedding(text)).vector;
          },
        }),
        concurrency: 1,
      }),
    );
    const id = (await as(o.admin).post('/api/runbooks', { title: 'Retry', content: AUTH_RUNBOOK }))
      .body.runbook.id;
    await waitFor(async () => (await runbookRow(id)).indexStatus === 'INDEXED');
    expect(calls).toBeGreaterThan(1);
  });
});

describe('retrieval', () => {
  it('returns the payment runbook for a connection-pool incident', async () => {
    const payment = await indexedRunbook(
      app,
      o,
      'Payment service troubleshooting',
      PAYMENT_RUNBOOK,
    );
    await indexedRunbook(app, o, 'Authentication failures', AUTH_RUNBOOK);
    const incident = await incidentWithEvidence(app, o);
    const evidence = (await gatherEvidence(db, orgId, incident.id))!;
    const hits = await retrieveRunbooks(db, orgId, evidence, new FakeProvider());
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.runbookTitle).toBe('Payment service troubleshooting');
    expect(hits[0]!.content).toMatch(/pool/i);
    expect(
      hits.every(
        (h) => h.runbookTitle === 'Payment service troubleshooting' || h.score < hits[0]!.score,
      ),
    ).toBe(true);
    void payment;
  });

  it('an authentication incident retrieves the authentication runbook instead', async () => {
    await indexedRunbook(app, o, 'Payment service troubleshooting', PAYMENT_RUNBOOK);
    await indexedRunbook(app, o, 'Authentication failures', AUTH_RUNBOOK);
    const vector = (
      await new FakeProvider().generateEmbedding(
        'users cannot sign in login 401 token secret',
        'query',
      )
    ).vector;
    const hits = await runbooksRepository.searchChunks(db, orgId, vector, 'fake-hash-768', 3);
    expect(hits[0]!.runbookTitle).toBe('Authentication failures');
  });

  it("never returns another organization's runbooks, even when they are the closest match", async () => {
    const other = await setupOrg(app, 'b');
    await indexedRunbook(app, other, 'Their payment runbook', PAYMENT_RUNBOOK);
    await indexedRunbook(app, o, 'Our auth runbook', AUTH_RUNBOOK);
    const vector = (
      await new FakeProvider().generateEmbedding('connection pool exhausted payment', 'query')
    ).vector;
    const hits = await runbooksRepository.searchChunks(db, orgId, vector, 'fake-hash-768', 10);
    expect(hits.map((h) => h.runbookTitle)).toEqual(
      expect.not.arrayContaining(['Their payment runbook']),
    );
    expect(hits.every((h) => h.runbookTitle === 'Our auth runbook')).toBe(true);
  });

  it('only compares vectors from the same embedding model', async () => {
    await indexedRunbook(app, o, 'Indexed with fake', PAYMENT_RUNBOOK);
    const vector = (await new FakeProvider().generateEmbedding('connection pool', 'query')).vector;
    expect(await runbooksRepository.searchChunks(db, orgId, vector, 'some-other-model', 5)).toEqual(
      [],
    );
  });

  it('ranks by cosine similarity, and a vector index exists on the embedding column', async () => {
    await indexedRunbook(app, o, 'Payment', PAYMENT_RUNBOOK);
    const vector = (
      await new FakeProvider().generateEmbedding('connection pool exhausted', 'query')
    ).vector;
    const hits = await runbooksRepository.searchChunks(db, orgId, vector, 'fake-hash-768', 5);
    for (let i = 1; i < hits.length; i++)
      expect(hits[i - 1]!.score).toBeGreaterThanOrEqual(hits[i]!.score);
    const idx = await db.execute(
      sql`SELECT indexdef FROM pg_indexes WHERE tablename = 'runbook_chunks' AND indexname = 'runbook_chunks_embedding_hnsw'`,
    );
    expect(String((idx.rows[0] as { indexdef: string }).indexdef)).toMatch(
      /hnsw.*vector_cosine_ops/,
    );
  });

  it('retrieval failure is not fatal: an embedding error yields no runbooks instead of throwing', async () => {
    const incident = await incidentWithEvidence(app, o);
    const evidence = (await gatherEvidence(db, orgId, incident.id))!;
    const broken = new FakeProvider({
      embed: () => {
        throw new AIProviderError('AI_UNAVAILABLE', 'down', true);
      },
    });
    expect(await retrieveRunbooks(db, orgId, evidence, broken)).toEqual([]);
  });
});
