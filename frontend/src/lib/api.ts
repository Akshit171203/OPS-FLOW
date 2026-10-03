import type { ApiErrorBody } from '@opsflow/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    credentials: 'same-origin',
    headers: {
      ...(json ? { 'content-type': 'application/json' } : {}),
      'x-requested-with': 'opsflow', // CSRF protection: required on cookie-authenticated writes
      ...rest.headers,
    },
    body: json ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      res.status,
      body?.error.code ?? 'UNKNOWN',
      body?.error.message ?? res.statusText,
    );
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
