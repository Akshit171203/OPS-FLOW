import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { incidents, users } from '../../db/schema';
import { seed } from '../../db/seed';
import { config } from '../../lib/config';
import { logger } from '../../lib/logger';
import { DEMO_EMAIL_DOMAIN } from '../../middleware/demoGuard';

/**
 * Boot-time check for the demo organization. A fresh database gets it created. One left over from an
 * older release (the demo admin exists but there is no incident history) is rebuilt, so a redeploy
 * never leaves visitors on an empty dashboard until the next scheduled reset.
 */
export async function ensureDemoData(): Promise<void> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, `demo-admin${DEMO_EMAIL_DOMAIN}`));
  if (existing) {
    const [hasHistory] = await db.select({ id: incidents.id }).from(incidents).limit(1);
    if (hasHistory) return;
  }
  logger.info('demo mode: seeding demo data');
  await seed();
  logger.info('demo mode: demo data ready');
}

/**
 * The public demo is shared, so visitors leave incidents, comments and runs behind. Rebuild it on a
 * schedule so it always looks fresh. Anyone signed in at that moment is returned to the login page, where
 * "Try the demo" signs them straight back in. Returns a function that stops the schedule.
 */
export function scheduleDemoReset(hours: number = config.DEMO_RESET_HOURS): () => void {
  if (hours <= 0) return () => undefined;
  let running = false;
  const timer = setInterval(() => {
    // A reset deletes and recreates the demo organization; two at once would fight over the same rows.
    if (running) return;
    running = true;
    seed()
      .then(
        () => logger.info('demo mode: demo data reset'),
        (err) => logger.error({ err }, 'demo mode: reset failed'),
      )
      .finally(() => {
        running = false;
      });
  }, hours * 3_600_000);
  timer.unref();
  return () => clearInterval(timer);
}
