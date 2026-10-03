import { buildApp } from './app';
import { getEventsQueue } from './events/queues';
import { config } from './lib/config';
import { logger } from './lib/logger';

getEventsQueue(); // connect to Redis at startup so the first publish is not delayed

buildApp().listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'api listening');
});
