import type { Server } from 'node:http';
import type { Express } from 'express';
import supertest from 'supertest';

/**
 * supertest, but every request carries the CSRF header exactly as the real frontend does, so
 * tests exercise the app the way a browser would. The CSRF tests import supertest directly
 * to send requests WITHOUT it.
 */
export const CSRF_HEADERS = { 'x-requested-with': 'opsflow' };

export default function request(app: Express | Server) {
  const agent = supertest(app);
  return {
    get: (url: string) => agent.get(url).set(CSRF_HEADERS),
    post: (url: string) => agent.post(url).set(CSRF_HEADERS),
    put: (url: string) => agent.put(url).set(CSRF_HEADERS),
    patch: (url: string) => agent.patch(url).set(CSRF_HEADERS),
    delete: (url: string) => agent.delete(url).set(CSRF_HEADERS),
  };
}
