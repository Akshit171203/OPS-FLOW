import { and, asc, eq, sql } from 'drizzle-orm';
import type { Role } from '@opsflow/shared';
import type { Executor } from '../../db/client';
import { organizationMembers, users } from '../../db/schema';

export const membersRepository = {
  listByOrg(ex: Executor, organizationId: string) {
    return (
      ex
        .select({
          id: organizationMembers.id,
          userId: users.id,
          email: users.email,
          name: users.name,
          role: organizationMembers.role,
        })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        // API-key service accounts are not people: never list them as members or offer them as assignees
        .where(and(eq(organizationMembers.organizationId, organizationId), eq(users.isBot, false)))
        .orderBy(asc(organizationMembers.createdAt))
    );
  },
  async findUserByEmail(ex: Executor, email: string) {
    const [u] = await ex.select().from(users).where(eq(users.email, email));
    return u;
  },
  async findMember(ex: Executor, organizationId: string, id: string) {
    const [m] = await ex
      .select()
      .from(organizationMembers)
      .where(
        and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.id, id)),
      );
    return m;
  },
  async findMemberByUser(ex: Executor, organizationId: string, userId: string) {
    const [m] = await ex
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.userId, userId),
          // an API key's service account is not a person: it cannot be assigned work or counted as a member
          sql`${organizationMembers.userId} IN (SELECT id FROM users WHERE is_bot = false)`,
        ),
      );
    return m;
  },
  async countOwners(ex: Executor, organizationId: string) {
    const rows = await ex
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.role, 'OWNER'),
        ),
      );
    return rows.length;
  },
  async insert(ex: Executor, v: { organizationId: string; userId: string; role: Role }) {
    const [m] = await ex.insert(organizationMembers).values(v).returning();
    return m!;
  },
  async updateRole(ex: Executor, organizationId: string, id: string, role: Role) {
    const [m] = await ex
      .update(organizationMembers)
      .set({ role })
      .where(
        and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.id, id)),
      )
      .returning();
    return m!;
  },
};
