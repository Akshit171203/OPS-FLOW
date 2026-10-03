import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from './request';
import { buildApp } from '../app';
import { pool } from '../db/client';
import { createIncident, resetDb, setupOrg, type TestOrg } from './helpers';

const app = buildApp();
let o: TestOrg;

afterAll(() => pool.end());
beforeEach(async () => {
  await resetDb();
  o = await setupOrg(app);
});

const post = (cookie: string, body: object) =>
  request(app).post('/api/logs').set('cookie', cookie).send(body);
const search = (cookie: string, qs = '') =>
  request(app).get(`/api/logs${qs}`).set('cookie', cookie);
const log = (over: Record<string, unknown> = {}) => ({
  serviceId: o.serviceId,
  level: 'INFO',
  message: 'hello',
  ...over,
});

describe('ingestion', () => {
  it('accepts a single log and a batch', async () => {
    expect((await post(o.engineer, log())).body).toEqual({ inserted: 1 });
    const batch = await post(o.engineer, {
      logs: [log({ message: 'a' }), log({ message: 'b', level: 'ERROR' })],
    });
    expect(batch.status).toBe(201);
    expect(batch.body.inserted).toBe(2);
    expect((await search(o.viewer)).body.items).toHaveLength(3);
  });

  it('enforces the batch size limit', async () => {
    const ok = await post(o.engineer, { logs: Array.from({ length: 500 }, () => log()) });
    expect(ok.status).toBe(201);
    const tooBig = await post(o.engineer, { logs: Array.from({ length: 501 }, () => log()) });
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error.code).toBe('VALIDATION_ERROR');
    expect((await post(o.engineer, { logs: [] })).status).toBe(400);
  });

  it('rejects unknown services and incidents, and other organizations resources', async () => {
    const other = await setupOrg(app, 'b');
    const foreign = await post(o.engineer, log({ serviceId: other.serviceId }));
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.code).toBe('UNKNOWN_SERVICE');
    const otherIncident = await createIncident(app, other.engineer, other.serviceId);
    const crossIncident = await post(o.engineer, log({ incidentId: otherIncident.id }));
    expect(crossIncident.body.error.code).toBe('UNKNOWN_INCIDENT');
    // nothing from a rejected batch is stored
    const mixed = await post(o.engineer, {
      logs: [log({ message: 'valid' }), log({ serviceId: other.serviceId })],
    });
    expect(mixed.status).toBe(400);
    expect((await search(o.owner)).body.items).toHaveLength(0);
  });

  it('VIEWER cannot ingest but can search; auth is required', async () => {
    expect((await post(o.viewer, log())).status).toBe(403);
    expect((await search(o.viewer)).status).toBe(200);
    expect((await request(app).post('/api/logs').send(log())).status).toBe(401);
  });
});

describe('search', () => {
  it('filters by level, service, incident, text and time range', async () => {
    const incident = await createIncident(app, o.engineer, o.serviceId);
    const t0 = Date.parse('2026-01-01T10:00:00Z');
    await post(o.engineer, {
      logs: [
        log({
          message: 'Connection pool exhausted',
          level: 'ERROR',
          timestamp: new Date(t0).toISOString(),
          incidentId: incident.id,
        }),
        log({
          message: 'Connection established',
          level: 'INFO',
          timestamp: new Date(t0 + 60_000).toISOString(),
        }),
        log({
          message: '100% CPU_usage high',
          level: 'WARN',
          timestamp: new Date(t0 + 120_000).toISOString(),
        }),
      ],
    });
    const msgs = async (qs: string) =>
      (await search(o.viewer, qs)).body.items.map((i: { message: string }) => i.message);

    expect(await msgs('?level=ERROR')).toEqual(['Connection pool exhausted']);
    expect(await msgs(`?incidentId=${incident.id}`)).toEqual(['Connection pool exhausted']);
    expect((await msgs(`?serviceId=${o.serviceId}`)).length).toBe(3);
    expect((await msgs('?q=connection')).sort()).toEqual([
      'Connection established',
      'Connection pool exhausted',
    ]); // case-insensitive
    expect(await msgs('?q=pool%20exhausted')).toEqual(['Connection pool exhausted']);
    expect(await msgs('?q=100%25')).toEqual(['100% CPU_usage high']); // % is literal, not a wildcard
    expect(await msgs('?q=CPU_u')).toEqual(['100% CPU_usage high']);
    expect(await msgs('?q=%25')).toEqual(['100% CPU_usage high']);
    expect(
      await msgs(
        `?from=${new Date(t0 + 30_000).toISOString()}&to=${new Date(t0 + 90_000).toISOString()}`,
      ),
    ).toEqual(['Connection established']);
    expect((await msgs('?level=ERROR&q=established')).length).toBe(0);
  });

  it('returns newest first, with the service name attached', async () => {
    await post(o.engineer, {
      logs: [
        log({ message: 'old', timestamp: '2026-01-01T00:00:00Z' }),
        log({ message: 'new', timestamp: '2026-01-02T00:00:00Z' }),
      ],
    });
    const { items } = (await search(o.viewer)).body;
    expect(items.map((i: { message: string }) => i.message)).toEqual(['new', 'old']);
    expect(items[0].serviceName).toBe('Payment Service');
  });

  it("never returns another organization's logs", async () => {
    const other = await setupOrg(app, 'b');
    await post(other.engineer, log({ serviceId: other.serviceId, message: 'secret' }));
    await post(o.engineer, log({ message: 'mine' }));
    const items = (await search(o.owner)).body.items;
    expect(items.map((i: { message: string }) => i.message)).toEqual(['mine']);
  });
});

describe('cursor pagination', () => {
  it('walks every log exactly once in order, including identical timestamps', async () => {
    const same = '2026-02-01T00:00:00.000Z';
    const logs = [
      ...Array.from({ length: 10 }, (_, i) => log({ message: `same-${i}`, timestamp: same })),
      ...Array.from({ length: 15 }, (_, i) =>
        log({
          message: `t-${i}`,
          timestamp: new Date(Date.parse(same) + (i + 1) * 1000).toISOString(),
        }),
      ),
    ];
    await post(o.engineer, { logs });

    const seen: { id: string; message: string; timestamp: string }[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await search(o.viewer, `?limit=7${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeLessThanOrEqual(7);
      seen.push(...res.body.items);
      cursor = res.body.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(pages).toBe(4); // 7 + 7 + 7 + 4
    expect(seen).toHaveLength(25);
    expect(new Set(seen.map((s) => s.id)).size).toBe(25); // no duplicates, nothing skipped
    const sorted = [...seen].sort(
      (a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id),
    );
    expect(seen.map((s) => s.id)).toEqual(sorted.map((s) => s.id));
  });

  it('has no nextCursor on the last page and rejects a bad cursor', async () => {
    await post(o.engineer, { logs: [log(), log()] });
    expect((await search(o.viewer, '?limit=2')).body.nextCursor).toBeNull();
    const bad = await search(o.viewer, '?cursor=not-a-cursor');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_CURSOR');
    expect((await search(o.viewer, '?limit=1000')).status).toBe(400);
  });

  it('keeps filters applied across pages', async () => {
    await post(o.engineer, {
      logs: Array.from({ length: 12 }, (_, i) =>
        log({ level: i % 2 ? 'ERROR' : 'INFO', message: `m${i}` }),
      ),
    });
    const first = await search(o.viewer, '?level=ERROR&limit=4');
    const second = await search(o.viewer, `?level=ERROR&limit=4&cursor=${first.body.nextCursor}`);
    const all = [...first.body.items, ...second.body.items];
    expect(all).toHaveLength(6);
    expect(all.every((l: { level: string }) => l.level === 'ERROR')).toBe(true);
    expect(second.body.nextCursor).toBeNull();
  });
});
