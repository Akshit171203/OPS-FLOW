import { expect } from 'vitest';
import type { Express } from 'express';
import type { ApiKeyScope, CreatedApiKeyDto } from '@opsflow/shared';
import request from './request';
import type { TestOrg } from './helpers';

export async function createKey(
  app: Express,
  cookie: string,
  over: { name?: string; scopes?: ApiKeyScope[]; serviceId?: string } = {},
): Promise<CreatedApiKeyDto> {
  const res = await request(app)
    .post('/api/api-keys')
    .set('cookie', cookie)
    .send({ name: 'CI pipeline', scopes: ['ingest', 'alerts'], ...over });
  expect(res.status).toBe(201);
  return res.body.key as CreatedApiKeyDto;
}

/** Requests made the way a pipeline or monitoring tool would: a Bearer key and nothing else. */
export function withKey(app: Express, key: string) {
  const auth = { authorization: `Bearer ${key}` };
  return {
    post: (url: string, body: object = {}) => request(app).post(url).set(auth).send(body),
    get: (url: string) => request(app).get(url).set(auth),
  };
}

export const alertBody = (o: TestOrg, over: Record<string, unknown> = {}) => ({
  service: 'payment',
  title: 'High error rate on checkout',
  severity: 'critical',
  ...over,
});
