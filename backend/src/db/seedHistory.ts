import { randomUUID } from 'node:crypto';
import type { Executor } from './client';
import {
  deployments,
  incidentComments,
  incidentDeployments,
  incidentEvents,
  incidents,
  logs,
  metrics,
  notifications,
  services,
} from './schema';

/**
 * Three weeks of believable operations for the demo organization: past incidents with timelines, comments and
 * linked deployments, a few that are still open, deployments (some failed or rolled back), metric spikes during
 * each incident, log bursts, and unread notifications. Everything is relative to "now" so the demo never looks stale,
 * and it is deterministic so every run produces the same story.
 */

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Svc = typeof services.$inferSelect;
type Actor = { id: string; email: string };

type Status = 'OPEN' | 'INVESTIGATING' | 'MITIGATING' | 'RESOLVED' | 'CLOSED';
interface Plan {
  hoursAgo: number;
  /** Minutes until resolved; null = still open */
  mins: number | null;
  slug: string;
  title: string;
  desc: string;
  sev: 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';
  pri: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status: Status;
  assignee: 'erin' | 'adam' | null;
  reporter: 'olivia' | 'adam' | 'erin' | 'alert';
  alert?: string;
  /** Version of the deployment that caused it, linked to the incident */
  culprit?: string;
  notes: [who: 'olivia' | 'adam' | 'erin', text: string][];
  errors: string[];
}

const PLANS: Plan[] = [
  {
    hoursAgo: 480,
    mins: 95,
    slug: 'payment-service',
    status: 'CLOSED',
    sev: 'SEV2',
    pri: 'HIGH',
    title: 'Card authorization timeouts at peak',
    assignee: 'erin',
    reporter: 'adam',
    culprit: 'v2.0.4',
    desc: 'Authorization calls to the card processor time out during the evening peak.',
    notes: [
      ['erin', 'Processor latency is normal. Our client timeout is 2s, their p99 is now 2.4s.'],
      ['adam', 'Raised the timeout to 5s behind a flag. Authorizations recovering.'],
    ],
    errors: [
      'Card processor call timed out after 2000ms',
      'Authorization failed for order ord_31877: upstream timeout',
    ],
  },
  {
    hoursAgo: 432,
    mins: 140,
    slug: 'auth-service',
    status: 'CLOSED',
    sev: 'SEV1',
    pri: 'URGENT',
    title: 'Token refresh failing for mobile clients',
    assignee: 'adam',
    reporter: 'alert',
    alert: 'auth-refresh-5xx',
    culprit: 'v2.1.0',
    desc: 'Mobile apps are being signed out because refresh requests return 500.',
    notes: [
      [
        'adam',
        'The new signing key was not distributed to every pod. Rolling back the key rotation.',
      ],
      ['olivia', 'Customer support confirms sign-in reports have stopped.'],
      ['erin', 'Post-mortem: add a startup check that every pod can verify the active key.'],
    ],
    errors: [
      'JWT verification failed: unknown key id kid=2026-09',
      'POST /auth/refresh 500 in 12ms',
      'Signing key lookup returned empty set',
    ],
  },
  {
    hoursAgo: 380,
    mins: 60,
    slug: 'notification-service',
    status: 'CLOSED',
    sev: 'SEV3',
    pri: 'MEDIUM',
    title: 'SMS provider returning 503',
    assignee: 'erin',
    reporter: 'erin',
    desc: 'The upstream SMS provider is rejecting requests; one-time codes are delayed.',
    notes: [
      [
        'erin',
        'Provider status page confirms a regional outage. Failing over to the secondary provider.',
      ],
    ],
    errors: [
      'SMS provider responded 503 Service Unavailable',
      'Retry 3/5 for message msg_92211 failed',
    ],
  },
  {
    hoursAgo: 330,
    mins: 85,
    slug: 'order-service',
    status: 'CLOSED',
    sev: 'SEV2',
    pri: 'HIGH',
    title: 'Orders stuck in PENDING after queue upgrade',
    assignee: 'adam',
    reporter: 'olivia',
    culprit: 'v2.1.1',
    desc: 'New orders are accepted but never move out of PENDING.',
    notes: [
      ['adam', 'Consumers were still subscribed to the old queue name after the upgrade.'],
      ['erin', 'Re-queued the 214 stuck orders. All processed.'],
    ],
    errors: ['No consumers registered for queue orders.v1', 'Order ord_55102 pending for 1800s'],
  },
  {
    hoursAgo: 290,
    mins: 45,
    slug: 'api-gateway',
    status: 'CLOSED',
    sev: 'SEV2',
    pri: 'HIGH',
    title: 'Elevated 502s after certificate rotation',
    assignee: 'erin',
    reporter: 'alert',
    alert: 'gateway-502-rate',
    desc: 'The gateway returns 502 for upstreams using the rotated internal certificate.',
    notes: [['erin', 'The intermediate certificate was missing from the upstream trust bundle.']],
    errors: [
      'TLS handshake failed: unable to verify the first certificate',
      'upstream connect error or disconnect/reset before headers',
    ],
  },
  {
    hoursAgo: 250,
    mins: 200,
    slug: 'search-service',
    status: 'CLOSED',
    sev: 'SEV3',
    pri: 'LOW',
    title: 'Search results stale after reindex job',
    assignee: 'erin',
    reporter: 'adam',
    desc: 'New products do not appear in search for several hours.',
    notes: [
      ['erin', 'The reindex wrote to a shadow index that was never swapped in.'],
      ['adam', 'Swapped the alias. Added the swap step to the job.'],
    ],
    errors: [
      'Index alias products_live still points at products_v41',
      'Reindex job finished without alias swap',
    ],
  },
  {
    hoursAgo: 210,
    mins: 70,
    slug: 'user-service',
    status: 'RESOLVED',
    sev: 'SEV3',
    pri: 'LOW',
    title: 'Profile images returning 404',
    assignee: 'adam',
    reporter: 'olivia',
    culprit: 'v2.2.0',
    desc: 'Avatar URLs 404 for users who changed their photo this week.',
    notes: [['adam', 'The CDN path changed in a configuration release. Restoring the old prefix.']],
    errors: ['GET /avatars/u_5521.png 404', 'Object not found in bucket user-avatars-v2'],
  },
  {
    hoursAgo: 170,
    mins: 120,
    slug: 'inventory-service',
    status: 'RESOLVED',
    sev: 'SEV2',
    pri: 'MEDIUM',
    title: 'Stock counts drifting after batch import',
    assignee: 'erin',
    reporter: 'erin',
    desc: 'Available stock differs from the warehouse system by up to 4%.',
    notes: [
      ['erin', 'Import ran twice for the same file because the lock expired.'],
      ['olivia', 'Finance has the corrected counts. Please add a dedupe key.'],
    ],
    errors: [
      'Import batch b_7781 already applied, applying again',
      'Lock inventory-import expired while job still running',
    ],
  },
  {
    hoursAgo: 150,
    mins: 55,
    slug: 'payment-service',
    status: 'RESOLVED',
    sev: 'SEV2',
    pri: 'HIGH',
    title: 'Duplicate charge reports',
    assignee: 'erin',
    reporter: 'alert',
    alert: 'payment-duplicate-charges',
    culprit: 'v2.2.0',
    desc: 'A small number of customers were charged twice for one order.',
    notes: [
      ['erin', 'A retry on the capture endpoint was missing its idempotency key.'],
      ['olivia', 'Refunds issued for the 9 affected customers.'],
    ],
    errors: [
      'Capture retried without idempotency key for order ord_60418',
      'Duplicate capture detected for charge ch_88231',
    ],
  },
  {
    hoursAgo: 112,
    mins: 35,
    slug: 'auth-service',
    status: 'RESOLVED',
    sev: 'SEV3',
    pri: 'MEDIUM',
    title: 'Login latency above 2 seconds',
    assignee: 'adam',
    reporter: 'erin',
    desc: 'Password sign-in is slow. Hashing time is normal.',
    notes: [['adam', 'A noisy neighbour on the database host. Moved the replica.']],
    errors: ['Slow query: SELECT * FROM sessions WHERE user_id = $1 (1850ms)'],
  },
  {
    hoursAgo: 52,
    mins: 150,
    slug: 'analytics-pipeline',
    status: 'RESOLVED',
    sev: 'SEV3',
    pri: 'MEDIUM',
    title: 'Event ingestion lagging by 40 minutes',
    assignee: 'erin',
    reporter: 'alert',
    alert: 'analytics-consumer-lag',
    desc: 'Dashboards show data that is 40 minutes old.',
    notes: [
      ['erin', 'One partition has a poison message that the consumer keeps retrying.'],
      ['adam', 'Dead-lettered the message. Lag draining.'],
    ],
    errors: [
      'Consumer lag on partition 7: 482113 messages',
      'Deserialization failed for offset 9120441, retrying',
    ],
  },
  {
    hoursAgo: 56,
    mins: 48,
    slug: 'order-service',
    status: 'RESOLVED',
    sev: 'SEV2',
    pri: 'HIGH',
    title: 'Checkout latency above 2s',
    assignee: 'adam',
    reporter: 'alert',
    alert: 'order-checkout-p95',
    desc: 'p95 checkout latency tripled after a burst of cache evictions.',
    notes: [['adam', 'The cache was resized down by an autoscaling rule. Pinning the minimum.']],
    errors: ['Cache miss ratio 0.91 for key family order:*', 'GET /checkout 200 in 2420ms'],
  },
  {
    hoursAgo: 27,
    mins: 40,
    slug: 'notification-service',
    status: 'RESOLVED',
    sev: 'SEV3',
    pri: 'MEDIUM',
    title: 'Email queue backing up',
    assignee: 'erin',
    reporter: 'adam',
    desc: 'Transactional email is delayed by up to 25 minutes.',
    notes: [
      ['erin', 'Worker concurrency was too low for the weekly digest. Scaled out and drained.'],
    ],
    errors: [
      'Email queue depth 18200, workers 2/2 busy',
      'Delivery delayed: msg_44109 waited 1440s',
    ],
  },
  // still open
  {
    hoursAgo: 5,
    mins: null,
    slug: 'search-service',
    status: 'INVESTIGATING',
    sev: 'SEV3',
    pri: 'MEDIUM',
    title: 'Search latency climbing during index merge',
    assignee: 'erin',
    reporter: 'alert',
    alert: 'search-latency-p95',
    desc: 'p95 search latency is 3x normal while a large index merge runs.',
    notes: [
      ['erin', 'Merge is I/O bound. Checking whether we can throttle it during business hours.'],
    ],
    errors: [
      'Segment merge running: 41GB remaining',
      'Search request exceeded 800ms budget (1710ms)',
    ],
  },
  {
    hoursAgo: 2.2,
    mins: null,
    slug: 'api-gateway',
    status: 'MITIGATING',
    sev: 'SEV2',
    pri: 'HIGH',
    title: 'Rate-limit rule blocking partner traffic',
    assignee: 'adam',
    reporter: 'olivia',
    culprit: 'v2.4.1',
    desc: 'A new rate-limit rule treats the partner network as one client and returns 429.',
    notes: [
      ['adam', 'Rolled the rule back for the partner CIDR range. 429s dropping.'],
      ['olivia', 'Two partners escalated. I am keeping them updated.'],
      ['erin', 'Reviewing the rule so we key by API key instead of by IP.'],
    ],
    errors: [
      'Rate limit exceeded for 203.0.113.0/24 (429)',
      'Partner request rejected: bucket partner-net empty',
    ],
  },
  {
    hoursAgo: 0.6,
    mins: null,
    slug: 'inventory-service',
    status: 'OPEN',
    sev: 'SEV3',
    pri: 'LOW',
    title: 'Reservation API returning 409 conflicts',
    assignee: null,
    reporter: 'alert',
    alert: 'inventory-409-rate',
    desc: 'Reservation requests intermittently fail with 409 during flash sales.',
    notes: [],
    errors: [
      'Reservation conflict for sku SKU-88213 (version mismatch)',
      'POST /reservations 409 in 31ms',
    ],
  },
];

const DEPLOY_PLAN: Record<
  string,
  [daysAgo: number, version: string, by: string, status?: 'FAILED' | 'ROLLED_BACK'][]
> = {
  'payment-service': [
    [20.2, 'v2.0.4', 'ci-pipeline'],
    [13.1, 'v2.1.0', 'erin.engineer'],
    [8.4, 'v2.2.0', 'ci-pipeline'],
    [5.6, 'v2.2.1', 'adam.admin', 'FAILED'],
    [4, 'v2.2.2', 'ci-pipeline'],
    [1.5, 'v2.3.0', 'ci-pipeline'],
  ],
  'auth-service': [
    [18.1, 'v1.8.2', 'ci-pipeline'],
    [18.05, 'v2.1.0', 'ci-pipeline', 'ROLLED_BACK'],
    [12, 'v2.1.1', 'erin.engineer'],
    [6.5, 'v2.2.0', 'ci-pipeline'],
    [2, 'v2.2.1', 'adam.admin'],
  ],
  'notification-service': [
    [16, 'v3.4.0', 'ci-pipeline'],
    [9.5, 'v3.5.0', 'erin.engineer'],
    [3, 'v3.5.1', 'ci-pipeline'],
  ],
  'order-service': [
    [14.2, 'v2.1.1', 'ci-pipeline'],
    [10, 'v2.2.0', 'adam.admin'],
    [4.5, 'v2.2.1', 'ci-pipeline'],
    [1, 'v2.2.2', 'ci-pipeline'],
  ],
  'user-service': [
    [15, 'v1.14.0', 'ci-pipeline'],
    [9, 'v1.14.1', 'erin.engineer'],
    [8.8, 'v2.2.0', 'ci-pipeline'],
    [3.5, 'v1.15.0', 'ci-pipeline'],
  ],
  'api-gateway': [
    [12.5, 'v4.0.1', 'ci-pipeline'],
    [7, 'v4.1.0', 'adam.admin'],
    [3, 'v4.2.0', 'ci-pipeline'],
    [0.15, 'v2.4.1', 'adam.admin'],
  ],
  'search-service': [
    [17, 'v0.9.3', 'ci-pipeline'],
    [10.4, 'v0.9.4', 'erin.engineer'],
    [5, 'v0.10.0', 'ci-pipeline', 'ROLLED_BACK'],
    [4.8, 'v0.10.1', 'ci-pipeline'],
  ],
  'inventory-service': [
    [19, 'v1.2.0', 'ci-pipeline'],
    [11, 'v1.3.0', 'erin.engineer'],
    [5.2, 'v1.3.1', 'ci-pipeline'],
    [0.5, 'v1.4.0', 'ci-pipeline'],
  ],
  'analytics-pipeline': [
    [16.5, 'v0.7.0', 'ci-pipeline'],
    [8, 'v0.7.1', 'erin.engineer'],
    [2.6, 'v0.8.0', 'ci-pipeline'],
  ],
};

/** Small deterministic PRNG, as in seed.ts */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const chunk = <T>(arr: T[], n: number) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export interface HistoryInput {
  tx: Executor;
  orgId: string;
  now: number;
  svcs: Svc[];
  users: { olivia: Actor; adam: Actor; erin: Actor; victor: Actor };
  bots: { alertmanager: Actor };
}

export async function seedHistory(h: HistoryInput) {
  const { tx, orgId, now, svcs, users: u } = h;
  const bySlug = new Map(svcs.map((s) => [s.slug, s]));

  // ---- deployments
  const depRows = Object.entries(DEPLOY_PLAN).flatMap(([slug, list]) =>
    list.map(([daysAgo, version, by, status], i) => ({
      organizationId: orgId,
      serviceId: bySlug.get(slug)!.id,
      version,
      commitSha: (0x1a2b000 + slug.length * 977 + i * 131 + Math.round(daysAgo * 100))
        .toString(16)
        .padStart(7, '0')
        .slice(-7),
      environment: 'production',
      deployedBy: by,
      deployedAt: new Date(now - daysAgo * DAY),
      status: status ?? ('SUCCESS' as const),
    })),
  );
  const insertedDeps = await tx.insert(deployments).values(depRows).returning();
  const depOf = (slug: string, version: string) =>
    insertedDeps.find((d) => d.serviceId === bySlug.get(slug)!.id && d.version === version);

  // ---- incidents, timelines, comments, links
  const actor = (w: Plan['reporter'] | 'olivia' | 'adam' | 'erin') =>
    w === 'olivia' ? u.olivia : w === 'adam' ? u.adam : w === 'erin' ? u.erin : h.bots.alertmanager;
  const spikes: { slug: string; from: number; to: number; sev: Plan['sev'] }[] = [];
  const errorLogs: (typeof logs.$inferInsert)[] = [];
  const noteWho = new Map<string, Actor>();
  const rand = rng(7);
  const notifRows: (typeof notifications.$inferInsert)[] = [];

  for (const p of PLANS) {
    const svc = bySlug.get(p.slug)!;
    const start = now - p.hoursAgo * HOUR;
    const end = p.mins === null ? null : start + p.mins * MIN;
    const reporter = actor(p.reporter);
    const assignee = p.assignee ? actor(p.assignee) : null;
    const [inc] = await tx
      .insert(incidents)
      .values({
        organizationId: orgId,
        serviceId: svc.id,
        title: p.title,
        description: p.desc,
        severity: p.sev,
        status: p.status,
        priority: p.pri,
        assignedTo: assignee?.id ?? null,
        createdBy: reporter.id,
        startedAt: new Date(start),
        resolvedAt: p.status === 'RESOLVED' || p.status === 'CLOSED' ? new Date(end!) : null,
        source: p.alert ? 'alertmanager' : 'manual',
        alertFingerprint: p.alert && p.mins === null ? p.alert : null,
        createdAt: new Date(start),
        updatedAt: new Date(end ?? now),
      })
      .returning();

    const ev = (
      offsetMin: number,
      who: Actor,
      eventType: string,
      metadata: Record<string, unknown>,
    ) => ({
      organizationId: orgId,
      incidentId: inc!.id,
      actorId: who.id,
      eventType,
      metadata,
      createdAt: new Date(start + offsetMin * MIN),
    });
    const events = [
      ev(0, reporter, 'incident.created', { title: p.title, severity: p.sev, serviceId: svc.id }),
    ];
    let t = 3;
    if (assignee) {
      events.push(ev(t, u.olivia, 'incident.assigned', { from: null, to: assignee.id }));
      t += 4;
    }
    const total = p.mins ?? Math.round(p.hoursAgo * 60);
    if (p.status !== 'OPEN') {
      events.push(
        ev(t, assignee ?? reporter, 'incident.status_changed', {
          from: 'OPEN',
          to: 'INVESTIGATING',
        }),
      );
    }
    if (p.culprit) {
      const dep = depOf(p.slug, p.culprit);
      if (dep) {
        events.push(
          ev(t + 2, reporter, 'incident.deployment_linked', {
            deploymentId: dep.id,
            version: dep.version,
          }),
        );
        await tx.insert(incidentDeployments).values({
          incidentId: inc!.id,
          deploymentId: dep.id,
          organizationId: orgId,
          linkedBy: reporter.id,
          createdAt: new Date(start + (t + 2) * MIN),
        });
      }
    }
    // comments spread across the incident
    const commentRows = p.notes.map(([who, body], i) => {
      const at = Math.round(((i + 1) / (p.notes.length + 1)) * total);
      noteWho.set(body, actor(who));
      return {
        organizationId: orgId,
        incidentId: inc!.id,
        authorId: actor(who).id,
        body,
        createdAt: new Date(start + at * MIN),
      };
    });
    const insertedComments = commentRows.length
      ? await tx.insert(incidentComments).values(commentRows).returning()
      : [];
    for (const c of insertedComments) {
      events.push({
        organizationId: orgId,
        incidentId: inc!.id,
        actorId: c.authorId,
        eventType: 'incident.comment_added',
        metadata: { commentId: c.id },
        createdAt: c.createdAt,
      });
    }
    if (p.status === 'MITIGATING')
      events.push(
        ev(Math.round(total * 0.6), assignee ?? reporter, 'incident.status_changed', {
          from: 'INVESTIGATING',
          to: 'MITIGATING',
        }),
      );
    if (p.status === 'RESOLVED' || p.status === 'CLOSED') {
      events.push(
        ev(Math.round(total * 0.6), assignee ?? reporter, 'incident.status_changed', {
          from: 'INVESTIGATING',
          to: 'MITIGATING',
        }),
      );
      events.push(
        ev(total, assignee ?? reporter, 'incident.status_changed', {
          from: 'MITIGATING',
          to: 'RESOLVED',
        }),
      );
    }
    if (p.status === 'CLOSED')
      events.push(
        ev(total + 180, u.olivia, 'incident.status_changed', { from: 'RESOLVED', to: 'CLOSED' }),
      );
    await tx.insert(incidentEvents).values(events);

    // metric spike while it lasted, and an error burst in the logs just before and during it
    spikes.push({ slug: p.slug, from: start, to: end ?? now, sev: p.sev });
    p.errors.forEach((message, k) => {
      for (let n = 0; n < (p.mins === null ? 6 : 4); n++) {
        errorLogs.push({
          organizationId: orgId,
          serviceId: svc.id,
          level: k === 0 && n % 3 === 2 ? 'WARN' : 'ERROR',
          message,
          requestId: `req-${Math.round(rand() * 0xfffff).toString(16)}`,
          metadata: {},
          timestamp: new Date(
            start - 8 * MIN + Math.round(rand() * Math.min(total, 90)) * MIN * 0.9 + n * 25_000,
          ),
        });
      }
    });
    if (p.hoursAgo <= 48 && p.hoursAgo > 0) {
      for (const user of [u.olivia, u.adam, u.erin]) {
        if (user.id === reporter.id) continue;
        notifRows.push({
          organizationId: orgId,
          userId: user.id,
          eventId: randomUUID(),
          type: 'incident.created',
          payload: { message: `${p.sev} opened on ${svc.name}: ${p.title}`, incidentId: inc!.id },
          readAt: p.mins === null && p.hoursAgo < 6 ? null : new Date(start + 20 * MIN),
          createdAt: new Date(start + MIN),
        });
      }
    }
  }
  if (notifRows.length) await tx.insert(notifications).values(notifRows);

  // ---- metrics: a good week of hourly points plus spikes (open incidents leave the service degraded right now)
  const baseline: Record<string, { rpm: number; lat: number }> = {
    'payment-service': { rpm: 640, lat: 180 },
    'auth-service': { rpm: 900, lat: 90 },
    'notification-service': { rpm: 300, lat: 140 },
    'order-service': { rpm: 520, lat: 160 },
    'user-service': { rpm: 700, lat: 110 },
    'api-gateway': { rpm: 2400, lat: 35 },
    'search-service': { rpm: 780, lat: 120 },
    'inventory-service': { rpm: 410, lat: 95 },
    'analytics-pipeline': { rpm: 150, lat: 320 },
  };
  const metricRows: (typeof metrics.$inferInsert)[] = [];
  svcs.forEach((svc, si) => {
    const b = baseline[svc.slug]!;
    const r = rng(1000 + si);
    for (let hh = 0; hh < 7 * 24; hh++) {
      const at = now - (7 * 24 - 1 - hh) * HOUR;
      const hourOfDay = new Date(at).getUTCHours();
      const day = 0.7 + 0.3 * Math.sin(((hourOfDay - 6) / 24) * 2 * Math.PI);
      metricRows.push({
        organizationId: orgId,
        serviceId: svc.id,
        errorRate: Number((0.002 + r() * 0.006).toFixed(4)),
        latencyMs: Math.round(b.lat * (0.85 + r() * 0.3)),
        requestsPerMin: Math.round(b.rpm * day * (0.9 + r() * 0.2)),
        healthStatus: 'HEALTHY',
        capturedAt: new Date(at),
      });
    }
  });
  const cutoff = now - 7 * DAY;
  for (const s of spikes) {
    if (s.to < cutoff) continue;
    const svc = bySlug.get(s.slug)!;
    const b = baseline[s.slug]!;
    const from = Math.max(s.from, cutoff);
    const step = 6 * MIN;
    const count = Math.max(4, Math.round((s.to - from) / step));
    const peak = s.sev === 'SEV1' ? 0.31 : s.sev === 'SEV2' ? 0.14 : 0.05;
    for (let i = 0; i <= count; i++) {
      const frac = i / count;
      const shape = Math.sin(Math.min(1, frac * 1.15) * Math.PI * 0.9 + 0.2) ** 2;
      const at = Math.min(s.to, from + (s.to - from) * frac);
      metricRows.push({
        organizationId: orgId,
        serviceId: svc.id,
        errorRate: Number((0.01 + peak * shape).toFixed(4)),
        latencyMs: Math.round(b.lat * (1.6 + 4.5 * shape)),
        requestsPerMin: Math.round(b.rpm * (0.78 - 0.18 * shape)),
        healthStatus: shape > 0.55 ? 'DEGRADED' : 'HEALTHY',
        capturedAt: new Date(at),
      });
    }
  }
  // services with open incidents are degraded right now: the newest snapshot says so
  const openSlugs = PLANS.filter((p) => p.mins === null && p.slug !== 'inventory-service').map(
    (p) => p.slug,
  );
  for (const slug of openSlugs) {
    const svc = bySlug.get(slug)!;
    const b = baseline[slug]!;
    metricRows.push({
      organizationId: orgId,
      serviceId: svc.id,
      errorRate: slug === 'api-gateway' ? 0.092 : 0.021,
      latencyMs: Math.round(b.lat * (slug === 'api-gateway' ? 3.4 : 3.1)),
      requestsPerMin: Math.round(b.rpm * 0.82),
      healthStatus: 'DEGRADED',
      capturedAt: new Date(now - 4 * MIN),
    });
  }
  for (const part of chunk(metricRows, 500)) await tx.insert(metrics).values(part);
  for (const slug of openSlugs) {
    await tx
      .update(services)
      .set({ status: 'DEGRADED' })
      .where(eqId(bySlug.get(slug)!.id));
  }

  // ---- logs: steady traffic for the last 12 hours plus the error bursts above
  const endpoints: Record<string, string[]> = {
    'payment-service': ['POST /v1/payments', 'GET /v1/payments/:id', 'POST /v1/refunds'],
    'auth-service': ['POST /auth/login', 'POST /auth/refresh', 'GET /auth/me'],
    'notification-service': ['POST /v1/email', 'POST /v1/sms', 'POST /v1/push'],
    'order-service': ['POST /v1/orders', 'GET /v1/orders/:id', 'PATCH /v1/orders/:id'],
    'user-service': ['GET /v1/users/:id', 'PATCH /v1/users/:id', 'GET /v1/users/:id/avatar'],
    'api-gateway': ['GET /v1/*', 'POST /v1/*', 'GET /health'],
    'search-service': ['GET /search?q=', 'GET /suggest', 'POST /index/products'],
    'inventory-service': ['GET /v1/stock/:sku', 'POST /v1/reservations', 'POST /v1/imports'],
    'analytics-pipeline': ['consume events.v1', 'flush batch', 'write warehouse'],
  };
  const baseLogs: (typeof logs.$inferInsert)[] = [];
  svcs.forEach((svc, si) => {
    const r = rng(500 + si);
    for (let i = 0; i < 26; i++) {
      const ep = endpoints[svc.slug]![i % 3]!;
      const warn = i % 9 === 4;
      baseLogs.push({
        organizationId: orgId,
        serviceId: svc.id,
        level: warn ? 'WARN' : 'INFO',
        message: warn
          ? `Slow request: ${ep} took ${900 + Math.round(r() * 700)}ms`
          : `${ep} 200 in ${30 + Math.round(r() * 110)}ms`,
        requestId: `req-${(0x2000 + si * 100 + i).toString(16)}`,
        metadata: {},
        timestamp: new Date(now - (26 - i) * 27 * MIN + Math.round(r() * 5) * MIN),
      });
    }
  });
  for (const part of chunk([...baseLogs, ...errorLogs], 400)) await tx.insert(logs).values(part);

  return {
    incidents: PLANS.length,
    deployments: depRows.length,
    logs: baseLogs.length + errorLogs.length,
    metrics: metricRows.length,
    notifications: notifRows.length,
  };
}

import { eq } from 'drizzle-orm';
const eqId = (id: string) => eq(services.id, id);
