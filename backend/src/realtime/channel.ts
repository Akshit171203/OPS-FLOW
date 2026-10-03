import type { Redis } from 'ioredis';
import { z } from 'zod';
import { realtimeEvents, type RealtimeEventName } from '@opsflow/shared';
import { config } from '../lib/config';
import { logger } from '../lib/logger';
import { createRedis } from '../lib/redis';

/**
 * Realtime fan-out goes through one Redis pub/sub channel. Any process (the API, or the worker,
 * which cannot hold sockets) publishes; every API instance subscribes and re-emits to its sockets.
 */
export const REALTIME_CHANNEL = `${config.QUEUE_PREFIX}:realtime`;

export const rooms = {
  org: (id: string) => `org:${id}`,
  user: (id: string) => `user:${id}`,
  incident: (id: string) => `incident:${id}`,
};

export const RealtimeMessageSchema = z.object({
  rooms: z.array(z.string().min(1)).min(1),
  event: z.enum(realtimeEvents),
  data: z.unknown(),
});
export type RealtimeMessage = z.infer<typeof RealtimeMessageSchema>;

const PUBLISH_TIMEOUT_MS = 2000;
let publisher: Redis | undefined;

/**
 * Best effort: live updates are a convenience, the database is the source of truth, and clients
 * refetch on reconnect. A Redis hiccup therefore never fails the request or the job.
 */
export async function publishRealtime(
  targetRooms: string[],
  event: RealtimeEventName,
  data: unknown,
): Promise<void> {
  try {
    publisher ??= createRedis();
    const message: RealtimeMessage = { rooms: targetRooms, event, data };
    await Promise.race([
      publisher.publish(REALTIME_CHANNEL, JSON.stringify(message)),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('realtime publish timed out')),
          PUBLISH_TIMEOUT_MS,
        ).unref(),
      ),
    ]);
  } catch (err) {
    logger.error({ err, event, rooms: targetRooms }, 'realtime publish failed');
  }
}

export async function closeRealtimePublisher(): Promise<void> {
  const p = publisher;
  publisher = undefined;
  if (p) await p.quit().catch(() => p.disconnect());
}
