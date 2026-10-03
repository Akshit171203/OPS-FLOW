import { eq, asc } from 'drizzle-orm';
import type { Role } from '@opsflow/shared';
import type { Executor } from '../../db/client';
import { organizationMembers, organizations, users } from '../../db/schema';

export const authRepository = {
  async findUserByEmail(ex: Executor, email: string) {
    const [user] = await ex.select().from(users).where(eq(users.email, email));
    return user;
  },
  async insertUser(ex: Executor, v: { email: string; passwordHash: string; name: string }) {
    const [user] = await ex.insert(users).values(v).returning();
    return user!;
  },
  async insertOrganization(ex: Executor, name: string) {
    const [org] = await ex.insert(organizations).values({ name }).returning();
    return org!;
  },
  async insertMember(ex: Executor, v: { organizationId: string; userId: string; role: Role }) {
    const [member] = await ex.insert(organizationMembers).values(v).returning();
    return member!;
  },
  async findFirstMembership(ex: Executor, userId: string) {
    const [m] = await ex
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, userId))
      .orderBy(asc(organizationMembers.createdAt))
      .limit(1);
    return m;
  },
};
