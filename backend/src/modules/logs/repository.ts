import { and, desc, eq, gte, ilike, inArray, lt, lte, or, type SQL } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { logs, services } from '../../db/schema';
import type { LogInput, SearchLogsQuery } from './schemas';

export interface LogCursor {
  t: string; // ISO timestamp
  id: string;
}

export const encodeCursor = (c: LogCursor) => Buffer.from(JSON.stringify(c)).toString('base64url');

export function decodeCursor(raw: string): LogCursor | null {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString()) as LogCursor;
    return typeof c.t === 'string' && typeof c.id === 'string' && !Number.isNaN(Date.parse(c.t))
      ? c
      : null;
  } catch {
    return null;
  }
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
const when = <T>(v: T | undefined, build: (v: T) => SQL): SQL | undefined =>
  v === undefined ? undefined : build(v);

export const logsRepository = {
  /** ERROR and WARN lines for one service since `since`, newest first (input to AI analysis). */
  forAnalysis(ex: Executor, organizationId: string, serviceId: string, since: Date, limit: number) {
    return ex
      .select({ timestamp: logs.timestamp, level: logs.level, message: logs.message })
      .from(logs)
      .where(
        and(
          eq(logs.organizationId, organizationId),
          eq(logs.serviceId, serviceId),
          inArray(logs.level, ['ERROR', 'WARN']),
          gte(logs.timestamp, since),
        ),
      )
      .orderBy(desc(logs.timestamp), desc(logs.id))
      .limit(limit);
  },

  async insertMany(ex: Executor, organizationId: string, items: LogInput[]) {
    await ex.insert(logs).values(
      items.map((i) => ({
        organizationId,
        serviceId: i.serviceId,
        incidentId: i.incidentId ?? null,
        level: i.level,
        message: i.message,
        requestId: i.requestId ?? null,
        metadata: i.metadata ?? {},
        // Always set explicitly from JS so every timestamp has millisecond precision. Postgres'
        // microsecond defaults would not round-trip through a cursor and could skip or repeat rows.
        timestamp: i.timestamp ?? new Date(),
      })),
    );
  },

  /** Keyset page ordered newest first; fetches one extra row so the caller can tell if more remain. */
  async search(ex: Executor, organizationId: string, q: SearchLogsQuery, cursor: LogCursor | null) {
    const where = and(
      eq(logs.organizationId, organizationId),
      when(q.level, (v) => eq(logs.level, v)),
      when(q.serviceId, (v) => eq(logs.serviceId, v)),
      when(q.incidentId, (v) => eq(logs.incidentId, v)),
      when(q.q, (v) => ilike(logs.message, `%${escapeLike(v)}%`)),
      when(q.from, (v) => gte(logs.timestamp, v)),
      when(q.to, (v) => lte(logs.timestamp, v)),
      cursor
        ? or(
            lt(logs.timestamp, new Date(cursor.t)),
            and(eq(logs.timestamp, new Date(cursor.t)), lt(logs.id, cursor.id)),
          )
        : undefined,
    );
    return ex
      .select({
        id: logs.id,
        serviceId: logs.serviceId,
        serviceName: services.name,
        incidentId: logs.incidentId,
        level: logs.level,
        message: logs.message,
        requestId: logs.requestId,
        metadata: logs.metadata,
        timestamp: logs.timestamp,
      })
      .from(logs)
      .innerJoin(services, eq(services.id, logs.serviceId))
      .where(where)
      .orderBy(desc(logs.timestamp), desc(logs.id))
      .limit(q.limit + 1);
  },
};
