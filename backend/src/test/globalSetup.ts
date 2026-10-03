import pg from 'pg';

export default async function setup() {
  const url = new URL(process.env.DATABASE_URL!);
  const dbName = url.pathname.slice(1);
  const admin = new pg.Client({
    connectionString: url.toString().replace(`/${dbName}`, '/postgres'),
  });
  await admin.connect();
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!rowCount) await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const { runMigrations } = await import('../db/migrate');
  const { pool } = await import('../db/client');
  await runMigrations();
  await pool.end();
}
