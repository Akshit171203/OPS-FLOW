'use client';

import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { RealtimeEventName } from '@opsflow/shared';

let socket: Socket | undefined;

/** One shared connection per tab. Same origin, so the session cookie authenticates it. */
export function getSocket(): Socket {
  socket ??= io({ path: '/api/socket.io', addTrailingSlash: false, withCredentials: true });
  return socket;
}

/** Run `handler` whenever the server pushes `event`. */
export function useSocketEvent<T = unknown>(event: RealtimeEventName, handler: (data: T) => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const s = getSocket();
    const listener = (data: T) => latest.current(data);
    s.on(event, listener);
    return () => {
      s.off(event, listener);
    };
  }, [event]);
}

/** Run `callback` after a RE-connect: events may have been missed, so the page should refetch. */
export function useReconnect(callback: () => void) {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    const s = getSocket();
    let first = true;
    const onConnect = () => {
      if (first) first = false;
      else latest.current();
    };
    s.on('connect', onConnect);
    return () => {
      s.off('connect', onConnect);
    };
  }, []);
}

/** Subscribe to one incident's room for as long as the page is open (and after reconnects). */
export function useIncidentRoom(incidentId: string) {
  useEffect(() => {
    const s = getSocket();
    const join = () => s.emit('incident:join', incidentId);
    if (s.connected) join();
    s.on('connect', join);
    return () => {
      s.off('connect', join);
      s.emit('incident:leave', incidentId);
    };
  }, [incidentId]);
}
