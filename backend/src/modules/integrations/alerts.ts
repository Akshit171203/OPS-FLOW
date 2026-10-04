import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { AlertResultDto } from '@opsflow/shared';
import { db } from '../../db/client';
import { incidentEvents } from '../../db/schema';
import type { RequestContext } from '../../lib/context';
import { isUniqueViolation } from '../../lib/dbErrors';
import { ForbiddenError, RateLimitError, ValidationError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { consume } from '../../lib/rateLimiter';
import { rules } from '../../middleware/rateLimit';
import { auditRepository } from '../audit/repository';
import { deploymentsRepository } from '../deployments/repository';
import { deploymentsService } from '../deployments/service';
import { emitIncidentRealtime } from '../incidents/events';
import { incidentsRepository } from '../incidents/repository';
import { incidentsService, toIncidentDto } from '../incidents/service';
import { servicesRepository } from '../services/repository';
import type { NormalizedAlert } from './adapters';

const MINUTE = 60_000;
/** A deployment this recent is a prime suspect, so a new alert incident is linked to it automatically. */
const AUTO_LINK_WINDOW_MS = 60 * MINUTE;
const AUTO_LINK_MAX = 3;
/** A flapping alert must not bury the timeline: at most one "fired again" entry per incident per minute. */
const REPEAT_NOTE_INTERVAL_MS = MINUTE;

const PRIORITY_FOR_SEVERITY = {
  SEV1: 'URGENT',
  SEV2: 'HIGH',
  SEV3: 'MEDIUM',
  SEV4: 'LOW',
} as const;

type Key = { serviceId: string | null };
type OpenIncident = NonNullable<
  Awaited<ReturnType<typeof incidentsRepository.findOpenByFingerprint>>
>;

async function resolveServiceId(orgId: string, alert: NormalizedAlert, key: Key): Promise<string> {
  let serviceId = alert.serviceId;
  if (!serviceId && alert.service) {
    const found = await servicesRepository.findBySlug(db, orgId, alert.service);
    if (!found) {
      throw new ValidationError(
        `No service with slug "${alert.service}" in this organization. Create it first.`,
        { service: alert.service },
        'UNKNOWN_SERVICE',
      );
    }
    serviceId = found.id;
  }
  if (key.serviceId) {
    if (serviceId && serviceId !== key.serviceId)
      throw new ForbiddenError(
        'This API key is tied to a different service',
        'KEY_SERVICE_MISMATCH',
      );
    serviceId = key.serviceId;
  }
  if (!serviceId) {
    throw new ValidationError(
      'Say which service the alert is about: send "service" (its slug), or use a key tied to one service',
      undefined,
      'SERVICE_REQUIRED',
    );
  }
  if (!(await servicesRepository.find(db, orgId, serviceId))) {
    throw new ValidationError(
      'Service not found in this organization',
      undefined,
      'UNKNOWN_SERVICE',
    );
  }
  return serviceId;
}

async function note(
  ctx: RequestContext,
  incident: OpenIncident,
  eventType: string,
  metadata: Record<string, unknown>,
) {
  const orgId = ctx.actor.organizationId;
  await db.transaction(async (tx) => {
    await incidentsRepository.insertEvent(tx, {
      organizationId: orgId,
      incidentId: incident.id,
      actorId: ctx.actor.userId,
      eventType,
      metadata,
    });
    await auditRepository.insert(tx, ctx, {
      action: eventType,
      resourceType: 'incident',
      resourceId: incident.id,
      metadata,
    });
  });
  await emitIncidentRealtime(ctx, toIncidentDto(incident), 'updated');
}

async function attachRepeat(ctx: RequestContext, incident: OpenIncident, alert: NormalizedAlert) {
  const [last] = await db
    .select({ at: incidentEvents.createdAt })
    .from(incidentEvents)
    .where(
      and(
        eq(incidentEvents.incidentId, incident.id),
        eq(incidentEvents.eventType, 'incident.alert_repeated'),
      ),
    )
    .orderBy(desc(incidentEvents.createdAt))
    .limit(1);
  if (last && Date.now() - last.at.getTime() < REPEAT_NOTE_INTERVAL_MS) return;
  await note(ctx, incident, 'incident.alert_repeated', {
    source: alert.source,
    title: alert.title,
    severity: alert.severity,
  });
}

async function linkRecentDeployments(ctx: RequestContext, incidentId: string, serviceId: string) {
  const since = new Date(Date.now() - AUTO_LINK_WINDOW_MS);
  const recent = await deploymentsRepository.listForIncident(
    db,
    ctx.actor.organizationId,
    incidentId,
    serviceId,
    since,
  );
  for (const d of recent.slice(0, AUTO_LINK_MAX)) {
    try {
      await deploymentsService.linkToIncident(ctx, incidentId, d.id);
    } catch (err) {
      logger.warn(
        { err, incident_id: incidentId, deployment_id: d.id },
        'could not auto-link a recent deployment',
      );
    }
  }
}

export const alertsService = {
  /**
   * One alert from a monitoring system. Firing: open an incident, or attach to the one already open for the
   * same fingerprint (a unique index guarantees a single open incident per fingerprint, even when copies
   * arrive at the same moment). Resolved: leave a note; closing an incident stays a human decision.
   */
  async handle(ctx: RequestContext, key: Key, alert: NormalizedAlert): Promise<AlertResultDto> {
    const orgId = ctx.actor.organizationId;
    const serviceId = await resolveServiceId(orgId, alert, key);
    const fingerprint =
      alert.fingerprint ?? createHash('sha1').update(`${serviceId}|${alert.title}`).digest('hex');
    const existing = await incidentsRepository.findOpenByFingerprint(db, orgId, fingerprint);

    if (alert.status === 'resolved') {
      if (!existing) return { action: 'ignored', incidentId: null, fingerprint };
      await note(ctx, existing, 'incident.alert_resolved', {
        source: alert.source,
        title: alert.title,
      });
      return { action: 'noted', incidentId: existing.id, fingerprint };
    }

    if (existing) {
      await attachRepeat(ctx, existing, alert);
      return { action: 'attached', incidentId: existing.id, fingerprint };
    }

    // Cap incidents opened automatically, so a storm of different alerts cannot flood the team
    try {
      const allowed = await consume(rules.autoIncidents, orgId);
      if (!allowed.allowed) {
        throw new RateLimitError(
          'Too many incidents were opened automatically this hour. Check your alert rules.',
          'AUTO_INCIDENT_LIMIT',
        );
      }
    } catch (err) {
      if (err instanceof RateLimitError) throw err;
    }

    try {
      const incident = await incidentsService.create(ctx, {
        serviceId,
        title: alert.title,
        description: [alert.description, `Raised automatically by ${alert.source}.`]
          .filter(Boolean)
          .join('\n\n'),
        severity: alert.severity,
        // nobody triaged this yet, so let the severity set how urgent it looks
        priority: PRIORITY_FOR_SEVERITY[alert.severity],
        source: alert.source,
        alertFingerprint: fingerprint,
      });
      await linkRecentDeployments(ctx, incident.id, serviceId);
      return { action: 'created', incidentId: incident.id, fingerprint };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Lost a race with an identical alert delivered at the same moment: join the winner's incident
      const winner = await incidentsRepository.findOpenByFingerprint(db, orgId, fingerprint);
      if (!winner) throw err;
      await attachRepeat(ctx, winner, alert);
      return { action: 'attached', incidentId: winner.id, fingerprint };
    }
  },
};
