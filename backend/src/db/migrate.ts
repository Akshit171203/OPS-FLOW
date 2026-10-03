import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client';

export async function runMigrations() {
  await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runMigrations();
  await pool.end();
  console.log('migrations applied');
}
