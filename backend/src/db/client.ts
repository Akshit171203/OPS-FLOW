import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../lib/config';
import * as schema from './schema';

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });
export const db = drizzle(pool, { schema });

export type Db = NodePgDatabase<typeof schema>;
/** Either the root db or a transaction handle; repositories accept both. */
export type Executor = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>;
