import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { z } from 'zod';
import { db } from '../db/client';
import { config } from '../lib/config';
import { logger } from '../lib/logger';
import { createRedis } from '../lib/redis';
import { authenticateToken, COOKIE_NAME, type AuthContext } from '../middleware/auth';
import { incidentsRepository } from '../modules/incidents/repository';
import { REALTIME_CHANNEL, RealtimeMessageSchema, rooms } from './channel';

type Ack = (result: { ok: boolean; error?: string }) => void;
const IncidentIdSchema = z.string().uuid();

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/**
 * Socket.IO on the same HTTP server as the API, authenticated with the same session cookie.
 * Sockets join their organization and user rooms automatically; an incident room only after an
 * ownership check. Events arrive from other processes over the Redis channel and are re-emitted.
 */
export function attachRealtime(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    path: '/api/socket.io',
    // Next's /api rewrite drops a trailing slash, so serve (and request) the path without one
    addTrailingSlash: false,
    cors: { origin: config.WEB_ORIGIN, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const token = cookieValue(socket.handshake.headers.cookie, COOKIE_NAME);
      socket.data.auth = await authenticateToken(token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const auth = socket.data.auth as AuthContext;
    void socket.join([rooms.org(auth.organizationId), rooms.user(auth.userId)]);

    socket.on('incident:join', async (raw: unknown, ack?: Ack) => {
      const id = IncidentIdSchema.safeParse(raw);
      if (!id.success) return ack?.({ ok: false, error: 'INVALID_ID' });
      // 404-style answer for other organizations' incidents: never confirm they exist
      const incident = await incidentsRepository.find(db, auth.organizationId, id.data);
      if (!incident) return ack?.({ ok: false, error: 'INCIDENT_NOT_FOUND' });
      await socket.join(rooms.incident(id.data));
      ack?.({ ok: true });
    });

    socket.on('incident:leave', async (raw: unknown, ack?: Ack) => {
      const id = IncidentIdSchema.safeParse(raw);
      if (id.success) await socket.leave(rooms.incident(id.data));
      ack?.({ ok: true });
    });
  });

  const subscriber = createRedis();
  // Resolves once the subscription is active, so tests (and startup) do not publish too early.
  const ready = subscriber.subscribe(REALTIME_CHANNEL).then(() => undefined);
  subscriber.on('message', (_channel, raw) => {
    try {
      const message = RealtimeMessageSchema.parse(JSON.parse(raw));
      io.to(message.rooms).emit(message.event, message.data);
    } catch (err) {
      logger.error({ err }, 'ignoring malformed realtime message');
    }
  });

  return {
    io,
    ready,
    async close() {
      await subscriber.quit().catch(() => subscriber.disconnect());
      await new Promise<void>((resolve) => void io.close(() => resolve()));
    },
  };
}
