import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../lib/config';
import { logger } from '../lib/logger';
import * as schema from './schema';

// Pool sizing: the API and the worker are separate processes with one pool each, so the server
// sees up to 2 x DB_POOL_MAX connections. Idle clients are recycled, a stuck acquire fails fast
// instead of queueing forever, and runaway queries are cut off by a server-side timeout.
export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: config.DB_POOL_MAX,
  idleTimeoutMillis: config.DB_POOL_IDLE_MS,
  connectionTimeoutMillis: config.DB_POOL_CONNECT_TIMEOUT_MS,
  statement_timeout: config.DB_STATEMENT_TIMEOUT_MS,
  application_name: 'opsflow',
});

// An error on an idle client (for example the database restarting) would otherwise crash the process.
pool.on('error', (err) => logger.error({ err }, 'idle postgres client error'));
export const db = drizzle(pool, { schema });

export type Db = NodePgDatabase<typeof schema>;
/** Either the root db or a transaction handle; repositories accept both. */
export type Executor = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>;
