import { buildApp } from './app';
import { config } from './lib/config';
import { logger } from './lib/logger';

buildApp().listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'api listening');
});
