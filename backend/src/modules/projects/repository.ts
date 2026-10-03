import { and, count, desc, eq } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { projects } from '../../db/schema';
import { offsetOf, type Pagination } from '../../lib/pagination';

export const projectsRepository = {
  async list(ex: Executor, organizationId: string, p: Pagination) {
    const where = eq(projects.organizationId, organizationId);
    const rows = await ex
      .select()
      .from(projects)
      .where(where)
      .orderBy(desc(projects.createdAt), projects.id)
      .limit(p.limit)
      .offset(offsetOf(p));
    const [{ total } = { total: 0 }] = await ex
      .select({ total: count() })
      .from(projects)
      .where(where);
    return { rows, total };
  },
  async find(ex: Executor, organizationId: string, id: string) {
    const [row] = await ex
      .select()
      .from(projects)
      .where(and(eq(projects.organizationId, organizationId), eq(projects.id, id)));
    return row;
  },
  async findBySlug(ex: Executor, organizationId: string, slug: string) {
    const [row] = await ex
      .select()
      .from(projects)
      .where(and(eq(projects.organizationId, organizationId), eq(projects.slug, slug)));
    return row;
  },
  async insert(
    ex: Executor,
    v: { organizationId: string; name: string; slug: string; description?: string },
  ) {
    const [row] = await ex.insert(projects).values(v).returning();
    return row!;
  },
  async update(
    ex: Executor,
    organizationId: string,
    id: string,
    set: { name?: string; description?: string | null },
  ) {
    const [row] = await ex
      .update(projects)
      .set({ ...set, updatedAt: new Date() })
      .where(and(eq(projects.organizationId, organizationId), eq(projects.id, id)))
      .returning();
    return row;
  },
};
