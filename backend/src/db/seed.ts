import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { eq, like } from 'drizzle-orm';
import type { Role } from '@opsflow/shared';
import { config, isProduction } from '../lib/config';
import { getAIProvider } from '../modules/ai';
import { indexRunbook, markIndexFailed } from '../modules/runbooks/indexer';
import { SEED_RUNBOOKS } from './seedRunbooks';
import { seedHistory } from './seedHistory';
import { db, pool } from './client';
import { organizationMembers, organizations, projects, runbooks, services, users } from './schema';

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
  { name: 'API Gateway', slug: 'api-gateway', baseRpm: 2400, baseLatency: 35 },
  { name: 'Search Service', slug: 'search-service', baseRpm: 780, baseLatency: 120 },
  { name: 'Inventory Service', slug: 'inventory-service', baseRpm: 410, baseLatency: 95 },
  { name: 'Analytics Pipeline', slug: 'analytics-pipeline', baseRpm: 150, baseLatency: 320 },
];
/** The first five belong to the Platform project, the rest to Edge & Data. */
const PLATFORM_SLUGS = [
  'payment-service',
  'auth-service',
  'notification-service',
  'order-service',
  'user-service',
];

/**
 * Recreates the demo organization from scratch (safe to run repeatedly): one org, a user per
 * role, nine services in two projects, and three weeks of history (see seedHistory.ts): past
 * and open incidents with timelines, deployments, metrics with spikes, logs and notifications.
 * The payment outage itself (error logs, degraded metrics, v2.4.0) is created by the Simulate
 * button so it can be replayed at will.
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

    const insertedProjects = await tx
      .insert(projects)
      .values([
        {
          organizationId: org!.id,
          name: 'Platform',
          slug: 'platform',
          description: 'Core platform services',
        },
        {
          organizationId: org!.id,
          name: 'Edge & Data',
          slug: 'edge-data',
          description: 'Gateway, search, inventory and analytics',
        },
      ])
      .returning();
    const projectFor = (slug: string) =>
      insertedProjects.find(
        (p) => p.slug === (PLATFORM_SLUGS.includes(slug) ? 'platform' : 'edge-data'),
      )!;
    const insertedServices = await tx
      .insert(services)
      .values(
        SERVICE_NAMES.map((s) => ({
          organizationId: org!.id,
          projectId: projectFor(s.slug).id,
          name: s.name,
          slug: s.slug,
          status: 'HEALTHY' as const,
        })),
      )
      .returning();

    // The alerting system that opens incidents on its own: a service account, never a person
    const [alertBot] = await tx
      .insert(users)
      .values({
        email: 'demo-alertmanager@opsflow.demo',
        name: 'Alertmanager',
        passwordHash: await argon2.hash(randomBytes(24).toString('hex')),
        isBot: true,
      })
      .returning();
    await tx
      .insert(organizationMembers)
      .values({ organizationId: org!.id, userId: alertBot!.id, role: 'ENGINEER' });

    const who = (email: string) => {
      const row = insertedUsers.find((x) => x.email === email)!;
      return { id: row.id, email: row.email };
    };
    const history = await seedHistory({
      tx,
      orgId: org!.id,
      now,
      svcs: insertedServices,
      users: {
        olivia: who('demo-owner@opsflow.demo'),
        adam: who('demo-admin@opsflow.demo'),
        erin: who('demo-engineer@opsflow.demo'),
        victor: who('demo-viewer@opsflow.demo'),
      },
      bots: { alertmanager: { id: alertBot!.id, email: alertBot!.email } },
    });

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
      ...history,
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
