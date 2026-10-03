import type { CursorPage, LogDto } from '@opsflow/shared';
import { db } from '../../db/client';
import type { RequestContext } from '../../lib/context';
import { ValidationError } from '../../lib/errors';
import { incidentsRepository } from '../incidents/repository';
import { servicesRepository } from '../services/repository';
import { decodeCursor, encodeCursor, logsRepository as repo } from './repository';
import type { LogInput, SearchLogsQuery } from './schemas';

export const logsService = {
  async ingest(ctx: RequestContext, items: LogInput[]): Promise<{ inserted: number }> {
    const orgId = ctx.actor.organizationId;
    const serviceIds = [...new Set(items.map((i) => i.serviceId))];
    const known = await servicesRepository.existingIds(db, orgId, serviceIds);
    const unknown = serviceIds.filter((id) => !known.has(id));
    if (unknown.length) {
      throw new ValidationError(
        'Unknown service for this organization',
        { serviceIds: unknown },
        'UNKNOWN_SERVICE',
      );
    }
    for (const incidentId of new Set(items.flatMap((i) => (i.incidentId ? [i.incidentId] : [])))) {
      if (!(await incidentsRepository.find(db, orgId, incidentId))) {
        throw new ValidationError(
          'Unknown incident for this organization',
          { incidentId },
          'UNKNOWN_INCIDENT',
        );
      }
    }
    await repo.insertMany(db, orgId, items);
    return { inserted: items.length };
  },

  async search(ctx: RequestContext, q: SearchLogsQuery): Promise<CursorPage<LogDto>> {
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    if (q.cursor && !cursor)
      throw new ValidationError('Invalid cursor', undefined, 'INVALID_CURSOR');
    const rows = await repo.search(db, ctx.actor.organizationId, q, cursor);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => ({ ...r, timestamp: r.timestamp.toISOString() })),
      nextCursor:
        rows.length > q.limit && last
          ? encodeCursor({ t: last.timestamp.toISOString(), id: last.id })
          : null,
    };
  },
};
