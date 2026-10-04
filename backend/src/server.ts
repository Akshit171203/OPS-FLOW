import { createServer } from 'node:http';
import { pool } from './db/client';
import { buildApp } from './app';
import { closeQueues, getEventsQueue } from './events/queues';
import { config } from './lib/config';
import { logger } from './lib/logger';
import { closeSharedRedis } from './lib/redis';
import { gracefulShutdown } from './lib/shutdown';
import { ensureDemoData, scheduleDemoReset } from './modules/demo/lifecycle';
import { closeRealtimePublisher } from './realtime/channel';
import { attachRealtime } from './realtime/server';
import { startWorkers } from './workers';

getEventsQueue(); // connect to Redis at startup so the first publish is not delayed

const server = createServer(buildApp());
const realtime = attachRealtime(server);

// One-process mode for hosts with no free background workers: the same workers, started here
const workers = config.EMBEDDED_WORKERS ? startWorkers() : [];
if (workers.length)
  logger.info({ queues: workers.map((w) => w.name) }, 'workers running inside the API process');

server.listen(config.PORT, () => {
  logger.info({ port: config.PORT, demo: config.DEMO_MODE }, 'api listening');
  if (config.DEMO_MODE) {
    ensureDemoData().catch((err) =>
      logger.error({ err }, 'demo mode: could not prepare demo data'),
    );
  }
});
const stopDemoReset = config.DEMO_MODE ? scheduleDemoReset() : () => undefined;

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'api shutting down: draining in-flight requests');
  stopDemoReset();
  await gracefulShutdown({
    // closes the listener, disconnects sockets, and resolves once in-flight requests have finished;
    // then any embedded workers stop taking jobs and finish the ones they have
    closeServer: async () => {
      await realtime.close();
      await Promise.all(workers.map((w) => w.close()));
    },
    cleanup: [closeQueues, closeRealtimePublisher, closeSharedRedis, () => pool.end()],
    timeoutMs: config.SHUTDOWN_TIMEOUT_MS,
    onTimeout: () => process.exit(1),
  });
  logger.info('api stopped');
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
