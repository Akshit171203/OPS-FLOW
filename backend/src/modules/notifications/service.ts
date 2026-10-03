import type { NotificationDto, Paginated } from '@opsflow/shared';
import { db } from '../../db/client';
import type { notifications } from '../../db/schema';
import type { RequestContext } from '../../lib/context';
import { NotFoundError } from '../../lib/errors';
import { paginated, type Pagination } from '../../lib/pagination';
import { notificationsRepository as repo } from './repository';

const toDto = (r: typeof notifications.$inferSelect): NotificationDto => ({
  id: r.id,
  type: r.type,
  message: r.payload.message,
  incidentId: r.payload.incidentId ?? null,
  readAt: r.readAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
});

export const notificationsService = {
  async list(ctx: RequestContext, p: Pagination, unreadOnly: boolean) {
    const { rows, total, unread } = await repo.list(
      db,
      ctx.actor.organizationId,
      ctx.actor.userId,
      p,
      unreadOnly,
    );
    return {
      ...(paginated(rows.map(toDto), total, p) satisfies Paginated<NotificationDto>),
      unreadCount: unread,
    };
  },

  async markRead(ctx: RequestContext, id: string): Promise<NotificationDto> {
    const row = await repo.markRead(db, ctx.actor.organizationId, ctx.actor.userId, id);
    if (!row) throw new NotFoundError('Notification not found', 'NOTIFICATION_NOT_FOUND');
    return toDto(row);
  },
};
