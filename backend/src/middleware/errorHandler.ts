import type { ErrorRequestHandler, Request, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@opsflow/shared';
import { AppError } from '../lib/errors';
import { isProduction } from '../lib/config';

function body(req: Request, code: string, message: string, details?: unknown): ApiErrorBody {
  return { error: { code, message, requestId: req.id, ...(details ? { details } : {}) } };
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json(body(req, 'NOT_FOUND', 'Route not found'));
};

// Express identifies error handlers by their four-argument signature.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json(body(req, err.code, err.message, err.details));
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json(body(req, 'VALIDATION_ERROR', 'Invalid request', err.flatten()));
    return;
  }
  // body-parser errors (malformed JSON, payload too large) carry a 4xx status
  const status = (err as { status?: number }).status;
  if (status && status >= 400 && status < 500) {
    const code = status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST';
    res.status(status).json(body(req, code, 'Bad request'));
    return;
  }
  req.log.error({ err }, 'unhandled error');
  const message = isProduction ? 'Internal server error' : (err as Error).message;
  res.status(500).json(body(req, 'INTERNAL_ERROR', message));
};
