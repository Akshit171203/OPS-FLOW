import type { Executor } from '../../db/client';
import { auditLogs } from '../../db/schema';
import type { RequestContext } from '../../lib/context';

export interface AuditEntry {
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
}

export const auditRepository = {
  async insert(ex: Executor, ctx: RequestContext, entry: AuditEntry) {
    await ex.insert(auditLogs).values({
      organizationId: ctx.actor.organizationId,
      actorId: ctx.actor.userId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      metadata: entry.metadata ?? {},
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });
  },
};
