import { defineConfig } from 'vitest/config';

const env = {
  NODE_ENV: 'test',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ?? 'postgres://opsflow:opsflow@localhost:5455/opsflow_test',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6390',
  JWT_SECRET: 'test-secret-test-secret-test-secret-123',
  WEB_ORIGIN: 'http://localhost:3000',
  QUEUE_PREFIX: 'opsflow-test',
  RETRY_DELAYS_MS: '30,30,30',
  LOG_LEVEL: 'silent',
};
// globalSetup runs in the main process, which does not receive `test.env`
Object.assign(process.env, env);

export default defineConfig({
  test: {
    env,
    setupFiles: ['./src/test/setup.ts'],
    globalSetup: ['./src/test/globalSetup.ts'],
    fileParallelism: false,
    testTimeout: 15000,
  },
});
