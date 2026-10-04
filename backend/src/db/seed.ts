import argon2 from 'argon2';
import { eq, like } from 'drizzle-orm';
import type { Role } from '@opsflow/shared';
import { config, isProduction } from '../lib/config';
import { getAIProvider } from '../modules/ai';
import { indexRunbook, markIndexFailed } from '../modules/runbooks/indexer';
import { SEED_RUNBOOKS } from './seedRunbooks';
import { db, pool } from './client';
import {
  deployments,
  logs,
  metrics,
  organizationMembers,
  organizations,
  projects,
  runbooks,
  services,
  users,
} from './schema';

export const DEMO_ORG_NAME = 'OpsFlow Demo';
export const DEMO_PASSWORD = 'demo-password-1';
export const DEMO_USERS: { email: string; name: string; role: Role }[] = [
  { email: 'demo-owner@opsflow.demo', name: 'Olivia Owner', role: 'OWNER' },
  { email: 'demo-admin@opsflow.demo', name: 'Adam Admin', role: 'ADMIN' },
  { email: 'demo-engineer@opsflow.demo', name: 'Erin Engineer', role: 'ENGINEER' },
  { email: 'demo-viewer@opsflow.demo', name: 'Victor Viewer', role: 'VIEWER' },
];

export const SERVICE_NAMES = [
  { name: 'Payment Service', slug: 'payment-service', baseRpm: 640, baseLatency: 180 },
  { name: 'Auth Service', slug: 'auth-service', baseRpm: 900, baseLatency: 90 },
  { name: 'Notification Service', slug: 'notification-service', baseRpm: 300, baseLatency: 140 },
  { name: 'Order Service', slug: 'order-service', baseRpm: 520, baseLatency: 160 },
  { name: 'User Service', slug: 'user-service', baseRpm: 700, baseLatency: 110 },
];

/** Small deterministic PRNG so the seeded week looks the same on every run. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const HOUR = 3_600_000;
const chunk = <T>(arr: T[], n: number) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/**
 * Recreates the demo organization from scratch (safe to run repeatedly): one org, a user per
 * role, five services, a week of hourly healthy metrics, deployment history and some
 * baseline logs. The outage itself (error logs, degraded metrics, v2.4.0) is created by the
 * Simulate button so it can be replayed at will.
 */
export async function seed() {
  if (isProduction && !config.DEMO_MODE) {
    throw new Error('Refusing to seed demo data in production unless DEMO_MODE=true');
  }

  // Wipe a previous run. Deleting the org cascades to everything it owns; users are separate.
  await db.delete(organizations).where(eq(organizations.name, DEMO_ORG_NAME));
  await db.delete(users).where(like(users.email, 'demo-%@opsflow.demo'));

  const passwordHash = await argon2.hash(DEMO_PASSWORD);
  const now = Date.now();

  const summary = await db.transaction(async (tx) => {
    const [org] = await tx.insert(organizations).values({ name: DEMO_ORG_NAME }).returning();
    const insertedUsers = await tx
      .insert(users)
      .values(DEMO_USERS.map((u) => ({ email: u.email, name: u.name, passwordHash })))
      .returning();
    await tx.insert(organizationMembers).values(
      insertedUsers.map((u) => ({
        organizationId: org!.id,
        userId: u.id,
        role: DEMO_USERS.find((d) => d.email === u.email)!.role,
      })),
    );

    const [project] = await tx
      .insert(projects)
      .values({
        organizationId: org!.id,
        name: 'Platform',
        slug: 'platform',
        description: 'Core platform services',
      })
      .returning();
    const insertedServices = await tx
      .insert(services)
      .values(
        SERVICE_NAMES.map((s) => ({
          organizationId: org!.id,
          projectId: project!.id,
          name: s.name,
          slug: s.slug,
          status: 'HEALTHY' as const,
        })),
      )
      .returning();

    // A week of hourly healthy snapshots per service
    const metricRows = insertedServices.flatMap((svc, si) => {
      const base = SERVICE_NAMES[si]!;
      const rand = rng(1000 + si);
      return Array.from({ length: 7 * 24 }, (_, h) => {
        const hourOfDay = (new Date(now - (7 * 24 - 1 - h) * HOUR).getUTCHours() + 24) % 24;
        const daytime = 0.7 + 0.3 * Math.sin(((hourOfDay - 6) / 24) * 2 * Math.PI);
        return {
          organizationId: org!.id,
          serviceId: svc.id,
          errorRate: Number((0.002 + rand() * 0.006).toFixed(4)),
          latencyMs: Math.round(base.baseLatency * (0.85 + rand() * 0.3)),
          requestsPerMin: Math.round(base.baseRpm * daytime * (0.9 + rand() * 0.2)),
          healthStatus: 'HEALTHY' as const,
          capturedAt: new Date(now - (7 * 24 - 1 - h) * HOUR),
        };
      });
    });
    for (const part of chunk(metricRows, 500)) await tx.insert(metrics).values(part);

    // Deployment history: a few releases per service over the week
    const authors = ['ci-pipeline', 'erin.engineer', 'adam.admin'];
    const deployRows = insertedServices.flatMap((svc, si) =>
      [6.5, 4, 1.5].map((daysAgo, di) => ({
        organizationId: org!.id,
        serviceId: svc.id,
        version: `v2.${di + (svc.slug === 'payment-service' ? 1 : 0)}.${si}`,
        commitSha: (0xabc0000 + si * 4096 + di * 97).toString(16).padStart(7, '0'),
        environment: 'production',
        deployedBy: authors[(si + di) % authors.length]!,
        deployedAt: new Date(now - daysAgo * 24 * HOUR),
        status: 'SUCCESS' as const,
      })),
    );
    await tx.insert(deployments).values(deployRows);

    // Baseline log lines (roughly 50) from the last few hours
    const rand = rng(42);
    const baseline = Array.from({ length: 50 }, (_, i) => {
      const svc = insertedServices[i % insertedServices.length]!;
      const warn = i % 11 === 0;
      return {
        organizationId: org!.id,
        serviceId: svc.id,
        level: warn ? ('WARN' as const) : ('INFO' as const),
        message: warn
          ? `Slow request: GET /api/v1/${svc.slug.split('-')[0]}/items took ${900 + Math.round(rand() * 400)}ms`
          : `Handled request GET /api/v1/${svc.slug.split('-')[0]}/items 200 in ${40 + Math.round(rand() * 80)}ms`,
        requestId: `req-${(0x1000 + i).toString(16)}`,
        metadata: {},
        timestamp: new Date(now - (50 - i) * 4 * 60_000),
      };
    });
    await tx.insert(logs).values(baseline);

    const owner = insertedUsers.find((u) => u.email === 'demo-owner@opsflow.demo')!;
    const insertedRunbooks = await tx
      .insert(runbooks)
      .values(
        SEED_RUNBOOKS.map((r) => ({
          organizationId: org!.id,
          createdBy: owner.id,
          updatedAt: new Date(),
          ...r,
        })),
      )
      .returning({ id: runbooks.id });

    return {
      organizationId: org!.id,
      runbookIds: insertedRunbooks.map((r) => r.id),
      runbooks: insertedRunbooks.length,
      services: insertedServices.length,
      metrics: metricRows.length,
      deployments: deployRows.length,
      logs: baseline.length,
    };
  });

  // Index the runbooks now, so retrieval works immediately after seeding. A provider problem
  // (for example no API key) leaves them FAILED with the reason instead of failing the seed.
  const provider = getAIProvider();
  for (const id of summary.runbookIds) {
    try {
      await indexRunbook(summary.organizationId, id, provider);
    } catch (err) {
      await markIndexFailed(id, err);
    }
  }
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const summary = await seed();
  await pool.end();
  console.log('Seeded demo organization:', summary);
  console.log(`Sign in with any of (password: ${DEMO_PASSWORD}):`);
  for (const u of DEMO_USERS) console.log(`  ${u.role.padEnd(9)} ${u.email}`);
}
