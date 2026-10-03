import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { notifications, organizationMembers } from '../../db/schema';
import { offsetOf, type Pagination } from '../../lib/pagination';

export const notificationsRepository = {
  async adminIds(ex: Executor, organizationId: string): Promise<string[]> {
    const rows = await ex
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          inArray(organizationMembers.role, ['OWNER', 'ADMIN']),
        ),
      );
    return rows.map((r) => r.userId);
  },

  /** Keeps only users who are (still) members of the organization. */
  async filterMembers(
    ex: Executor,
    organizationId: string,
    userIds: string[],
  ): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await ex
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          inArray(organizationMembers.userId, userIds),
        ),
      );
    return new Set(rows.map((r) => r.userId));
  },

  async insertMany(ex: Executor, rows: (typeof notifications.$inferInsert)[]) {
    if (rows.length === 0) return [];
    return ex.insert(notifications).values(rows).onConflictDoNothing().returning();
  },

  async list(
    ex: Executor,
    organizationId: string,
    userId: string,
    p: Pagination,
    unreadOnly: boolean,
  ) {
    const scope = and(
      eq(notifications.organizationId, organizationId),
      eq(notifications.userId, userId),
    );
    const where = unreadOnly ? and(scope, isNull(notifications.readAt)) : scope;
    const rows = await ex
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(p.limit)
      .offset(offsetOf(p));
    const [{ total } = { total: 0 }] = await ex
      .select({ total: count() })
      .from(notifications)
      .where(where);
    const [{ unread } = { unread: 0 }] = await ex
      .select({ unread: count() })
      .from(notifications)
      .where(and(scope, isNull(notifications.readAt)));
    return { rows, total, unread };
  },

  async markRead(ex: Executor, organizationId: string, userId: string, id: string) {
    const scope = and(
      eq(notifications.id, id),
      eq(notifications.organizationId, organizationId),
      eq(notifications.userId, userId),
    );
    await ex
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(scope, isNull(notifications.readAt)));
    const [row] = await ex.select().from(notifications).where(scope);
    return row;
  },
};
