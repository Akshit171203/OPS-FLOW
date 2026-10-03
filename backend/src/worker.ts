import { closeQueues } from './events/queues';
import { pool } from './db/client';
import { logger } from './lib/logger';
import { createEventWorker } from './workers/eventWorker';

const worker = createEventWorker();
logger.info('worker started');

async function shutdown(signal: string) {
  logger.info({ signal }, 'worker shutting down');
  await worker.close(); // lets active jobs finish
  await closeQueues();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
