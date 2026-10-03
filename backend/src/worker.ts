import { closeQueues } from './events/queues';
import { pool } from './db/client';
import { config } from './lib/config';
import { logger } from './lib/logger';
import { closeSharedRedis } from './lib/redis';
import { gracefulShutdown } from './lib/shutdown';
import { closeRealtimePublisher } from './realtime/channel';
import { createEventWorker } from './workers/eventWorker';

const worker = createEventWorker();
logger.info('worker started');

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'worker shutting down: finishing active jobs');
  await gracefulShutdown({
    closeServer: () => worker.close(), // stops taking jobs and waits for active ones to finish
    cleanup: [closeQueues, closeRealtimePublisher, closeSharedRedis, () => pool.end()],
    timeoutMs: config.SHUTDOWN_TIMEOUT_MS,
    onTimeout: () => process.exit(1),
  });
  logger.info('worker stopped');
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
