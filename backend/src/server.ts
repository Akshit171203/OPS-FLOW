import { createServer } from 'node:http';
import { buildApp } from './app';
import { getEventsQueue } from './events/queues';
import { config } from './lib/config';
import { logger } from './lib/logger';
import { attachRealtime } from './realtime/server';

getEventsQueue(); // connect to Redis at startup so the first publish is not delayed

const server = createServer(buildApp());
attachRealtime(server);
server.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'api listening');
});
