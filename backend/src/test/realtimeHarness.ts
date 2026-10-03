import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connectClient, type Socket } from 'socket.io-client';
import { buildApp } from '../app';
import { attachRealtime } from '../realtime/server';
import { sleep } from './helpers';

export interface Harness {
  app: ReturnType<typeof buildApp>;
  url: string;
  close: () => Promise<void>;
  connect: (cookie?: string, headers?: Record<string, string>) => Promise<Socket>;
  /** Resolves with the payload of the next `event` on `socket`, or rejects after `timeoutMs`. */
  next: <T = unknown>(socket: Socket, event: string, timeoutMs?: number) => Promise<T>;
  /** Asserts that `event` does NOT arrive on `socket` within `ms`. */
  never: (socket: Socket, event: string, ms?: number) => Promise<void>;
}

/** An HTTP server running the API and Socket.IO together on an ephemeral port. */
export async function createRealtimeTestHarness(): Promise<Harness> {
  const app = buildApp();
  const server: HttpServer = createServer(app);
  const realtime = attachRealtime(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  await realtime.ready;
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const sockets: Socket[] = [];

  return {
    app,
    url,
    async connect(cookie, headers = {}) {
      const socket = connectClient(url, {
        path: '/api/socket.io',
        addTrailingSlash: false,
        transports: ['websocket'],
        extraHeaders: { ...(cookie ? { cookie } : {}), ...headers },
        reconnection: false,
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', (err) => reject(err));
      });
      return socket;
    },
    next(socket, event, timeoutMs = 4000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`timed out waiting for "${event}"`)),
          timeoutMs,
        );
        socket.once(event, (data) => {
          clearTimeout(timer);
          resolve(data);
        });
      });
    },
    async never(socket, event, ms = 400) {
      let received = false;
      const handler = () => (received = true);
      socket.on(event, handler);
      await sleep(ms);
      socket.off(event, handler);
      if (received) throw new Error(`unexpected "${event}" event`);
    },
    async close() {
      for (const s of sockets) s.disconnect();
      await realtime.close();
    },
  };
}
