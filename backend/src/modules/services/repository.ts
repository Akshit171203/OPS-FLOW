import { and, count, desc, eq } from 'drizzle-orm';
import type { ServiceStatus } from '@opsflow/shared';
import type { Executor } from '../../db/client';
import { projects, services } from '../../db/schema';
import { offsetOf, type Pagination } from '../../lib/pagination';

const selection = {
  id: services.id,
  projectId: services.projectId,
  projectName: projects.name,
  name: services.name,
  slug: services.slug,
  status: services.status,
  createdAt: services.createdAt,
};

export const servicesRepository = {
  async list(ex: Executor, organizationId: string, p: Pagination, projectId?: string) {
    const where = and(
      eq(services.organizationId, organizationId),
      projectId ? eq(services.projectId, projectId) : undefined,
    );
    const rows = await ex
      .select(selection)
      .from(services)
      .innerJoin(projects, eq(projects.id, services.projectId))
      .where(where)
      .orderBy(desc(services.createdAt), services.id)
      .limit(p.limit)
      .offset(offsetOf(p));
    const [{ total } = { total: 0 }] = await ex
      .select({ total: count() })
      .from(services)
      .where(where);
    return { rows, total };
  },
  async find(ex: Executor, organizationId: string, id: string) {
    const [row] = await ex
      .select(selection)
      .from(services)
      .innerJoin(projects, eq(projects.id, services.projectId))
      .where(and(eq(services.organizationId, organizationId), eq(services.id, id)));
    return row;
  },
  async insert(
    ex: Executor,
    v: {
      organizationId: string;
      projectId: string;
      name: string;
      slug: string;
      status?: ServiceStatus;
    },
  ) {
    const [row] = await ex.insert(services).values(v).returning({ id: services.id });
    return row!;
  },
  async update(
    ex: Executor,
    organizationId: string,
    id: string,
    set: { name?: string; status?: ServiceStatus },
  ) {
    const [row] = await ex
      .update(services)
      .set({ ...set, updatedAt: new Date() })
      .where(and(eq(services.organizationId, organizationId), eq(services.id, id)))
      .returning({ id: services.id });
    return row;
  },
};
