import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger';

const SAFE_ID = /^[\w.-]{1,128}$/;

/** Reads x-request-id (or generates one), echoes it back, and gives the request a child logger. */
export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.id);
  req.log = logger.child({ request_id: req.id });

  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    req.log.info(
      { method: req.method, url: req.originalUrl, status: res.statusCode, ms },
      'request',
    );
  });
  next();
}
