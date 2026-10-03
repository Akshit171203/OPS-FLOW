import type { Executor } from '../../db/client';
import { auditLogs } from '../../db/schema';
import type { RequestContext } from '../../lib/context';

export interface AuditEntry {
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
}

export interface AuditActor {
  organizationId: string;
  actorId: string;
  ip?: string | null;
  userAgent?: string | null;
}

export const auditRepository = {
  /** Audit an action that has no HTTP request (for example work done by a background worker). */
  async insertFor(ex: Executor, actor: AuditActor, entry: AuditEntry) {
    await ex.insert(auditLogs).values({
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      metadata: entry.metadata ?? {},
      ipAddress: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
    });
  },

  async insert(ex: Executor, ctx: RequestContext, entry: AuditEntry) {
    await this.insertFor(
      ex,
      {
        organizationId: ctx.actor.organizationId,
        actorId: ctx.actor.userId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      entry,
    );
  },
};
