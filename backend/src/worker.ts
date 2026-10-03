import { closeQueues } from './events/queues';
import { pool } from './db/client';
import { config } from './lib/config';
import { logger } from './lib/logger';
import { closeSharedRedis } from './lib/redis';
import { gracefulShutdown } from './lib/shutdown';
import { closeRealtimePublisher } from './realtime/channel';
import { createAnalysisWorker } from './workers/analysisWorker';
import { createEventWorker } from './workers/eventWorker';
import { createRunbookWorker } from './workers/runbookWorker';

const workers = [createEventWorker(), createRunbookWorker(), createAnalysisWorker()];
logger.info({ queues: workers.map((w) => w.name) }, 'worker started');

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'worker shutting down: finishing active jobs');
  await gracefulShutdown({
    // each worker stops taking jobs and waits for its active ones to finish
    closeServer: () => Promise.all(workers.map((w) => w.close())),
    cleanup: [closeQueues, closeRealtimePublisher, closeSharedRedis, () => pool.end()],
    timeoutMs: config.SHUTDOWN_TIMEOUT_MS,
    onTimeout: () => process.exit(1),
  });
  logger.info('worker stopped');
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
