import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { ApiKeyScope } from '@opsflow/shared';
import type { Executor } from '../../db/client';
import { apiKeys, organizations, services, users } from '../../db/schema';

export const apiKeysRepository = {
  async insert(
    ex: Executor,
    v: {
      organizationId: string;
      name: string;
      keyPrefix: string;
      keyHash: string;
      scopes: ApiKeyScope[];
      serviceId: string | null;
      botUserId: string;
      createdBy: string;
    },
  ) {
    const [row] = await ex.insert(apiKeys).values(v).returning();
    return row!;
  },

  async createBotUser(ex: Executor, v: { email: string; name: string; passwordHash: string }) {
    const [row] = await ex
      .insert(users)
      .values({ ...v, isBot: true })
      .returning({ id: users.id });
    return row!;
  },

  list(ex: Executor, organizationId: string) {
    return ex
      .select({ key: apiKeys, serviceName: services.name })
      .from(apiKeys)
      .leftJoin(services, eq(services.id, apiKeys.serviceId))
      .where(eq(apiKeys.organizationId, organizationId))
      .orderBy(desc(apiKeys.createdAt), desc(apiKeys.id));
  },

  async find(ex: Executor, organizationId: string, id: string) {
    const [row] = await ex
      .select({ key: apiKeys, serviceName: services.name })
      .from(apiKeys)
      .leftJoin(services, eq(services.id, apiKeys.serviceId))
      .where(and(eq(apiKeys.organizationId, organizationId), eq(apiKeys.id, id)));
    return row;
  },

  /** Everything needed to authenticate a request made with a key, looked up by the key's hash. */
  async findByHash(ex: Executor, keyHash: string) {
    const [row] = await ex
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        scopes: apiKeys.scopes,
        serviceId: apiKeys.serviceId,
        revokedAt: apiKeys.revokedAt,
        botUserId: apiKeys.botUserId,
        organizationId: apiKeys.organizationId,
        organizationName: organizations.name,
        botEmail: users.email,
      })
      .from(apiKeys)
      .innerJoin(organizations, eq(organizations.id, apiKeys.organizationId))
      .innerJoin(users, eq(users.id, apiKeys.botUserId))
      .where(eq(apiKeys.keyHash, keyHash));
    return row;
  },

  async revoke(ex: Executor, organizationId: string, id: string) {
    const [row] = await ex
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiKeys.organizationId, organizationId),
          eq(apiKeys.id, id),
          isNull(apiKeys.revokedAt),
        ),
      )
      .returning();
    return row;
  },

  /** At most one write per key per minute, so a busy key does not turn every request into a database write. */
  async touchLastUsed(ex: Executor, id: string) {
    await ex
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(apiKeys.id, id),
          or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, sql`now() - interval '1 minute'`)),
        ),
      );
  },
};
