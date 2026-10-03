import { createServer } from 'node:http';
import { pool } from './db/client';
import { buildApp } from './app';
import { closeQueues, getEventsQueue } from './events/queues';
import { config } from './lib/config';
import { logger } from './lib/logger';
import { closeSharedRedis } from './lib/redis';
import { gracefulShutdown } from './lib/shutdown';
import { closeRealtimePublisher } from './realtime/channel';
import { attachRealtime } from './realtime/server';

getEventsQueue(); // connect to Redis at startup so the first publish is not delayed

const server = createServer(buildApp());
const realtime = attachRealtime(server);
server.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'api listening');
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'api shutting down: draining in-flight requests');
  await gracefulShutdown({
    // closes the listener, disconnects sockets, and resolves once in-flight requests have finished
    closeServer: () => realtime.close(),
    cleanup: [closeQueues, closeRealtimePublisher, closeSharedRedis, () => pool.end()],
    timeoutMs: config.SHUTDOWN_TIMEOUT_MS,
    onTimeout: () => process.exit(1),
  });
  logger.info('api stopped');
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
