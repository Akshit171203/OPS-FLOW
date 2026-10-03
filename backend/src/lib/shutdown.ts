import { setDraining } from './health';
import { logger } from './logger';

export interface ShutdownOptions {
  /** Stop accepting work and resolve once in-flight work has finished (server.close, worker.close). */
  closeServer: () => Promise<unknown>;
  /** Then release shared resources in order (queues, Redis, database pool). */
  cleanup: (() => Promise<unknown>)[];
  timeoutMs: number;
  /** Called if shutdown takes longer than timeoutMs; production exits non-zero. */
  onTimeout?: () => void;
}

/**
 * Graceful shutdown: flip /ready to 503, stop accepting new work, let in-flight work finish,
 * then close dependencies. A timer bounds the whole thing so a stuck request cannot block a
 * deploy forever.
 */
export async function gracefulShutdown({
  closeServer,
  cleanup,
  timeoutMs,
  onTimeout,
}: ShutdownOptions) {
  setDraining(true);
  const timer = setTimeout(() => {
    logger.error({ timeoutMs }, 'graceful shutdown timed out');
    onTimeout?.();
  }, timeoutMs);
  timer.unref();
  try {
    await closeServer();
    for (const step of cleanup) {
      await step().catch((err) => logger.error({ err }, 'error during shutdown cleanup'));
    }
  } finally {
    clearTimeout(timer);
  }
}
