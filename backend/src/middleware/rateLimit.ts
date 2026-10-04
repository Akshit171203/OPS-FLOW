import type { Request, RequestHandler } from 'express';
import { RateLimitError } from '../lib/errors';
import { consume, type RateLimitRule } from '../lib/rateLimiter';

const MINUTE = 60_000;

/** Every limit in one place so they are easy to review and tune. */
export const rules = {
  login: { name: 'login', limit: 5, windowMs: MINUTE },
  /** Backstop for login: blunts rotating IPs against one account. */
  loginByEmail: { name: 'login-email', limit: 20, windowMs: MINUTE },
  register: { name: 'register', limit: 10, windowMs: 60 * MINUTE },
  /** Registration answers "that email is taken", which tells a visitor who has an account. Only email verification would remove that, so until then the same address can be tried only a few times an hour. */
  registerByEmail: { name: 'register-email', limit: 3, windowMs: 60 * MINUTE },
  createIncident: { name: 'create-incident', limit: 20, windowMs: MINUTE },
  simulate: { name: 'simulate', limit: 6, windowMs: MINUTE },
  ingestLogs: { name: 'ingest-logs', limit: 300, windowMs: MINUTE },
  /** Failed API key attempts per IP: stops key guessing long before it could matter. */
  badApiKey: { name: 'bad-api-key', limit: 30, windowMs: MINUTE },
  /** Alerts per API key. Monitoring tools can send bursts, so this is generous. */
  alerts: { name: 'alerts', limit: 120, windowMs: MINUTE },
  /** New incidents opened automatically per organization: a storm of distinct alerts must not flood the team. */
  autoIncidents: { name: 'auto-incidents', limit: 30, windowMs: 60 * MINUTE },
  /** Wired to the AI analysis endpoint in Phase 6. */
  aiAnalysis: { name: 'ai-analysis', limit: 10, windowMs: MINUTE },
} satisfies Record<string, RateLimitRule>;

/**
 * Rejects with 429 and a Retry-After header once `rule.limit` requests were made by the same
 * key inside the window. Returning null from `key` skips the limit. If Redis is unavailable the
 * request is allowed (fail open) and the error is logged: losing rate limiting is preferable
 * to taking the whole API down with Redis.
 */
export function rateLimit(
  rule: RateLimitRule,
  key: (req: Request) => string | null,
): RequestHandler {
  return async (req, res, next) => {
    const k = key(req);
    if (k === null) return next();
    try {
      const result = await consume(rule, k);
      res.setHeader('RateLimit-Limit', String(rule.limit));
      res.setHeader('RateLimit-Remaining', String(result.remaining));
      if (!result.allowed) {
        const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
        res.setHeader('Retry-After', String(seconds));
        throw new RateLimitError(`Too many requests. Try again in ${seconds} seconds.`);
      }
    } catch (err) {
      if (err instanceof RateLimitError) throw err;
      req.log.error({ err, limit: rule.name }, 'rate limiter unavailable, allowing request');
    }
    next();
  };
}

const emailOf = (req: Request) =>
  typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

export const loginLimit = rateLimit(rules.login, (req) => `${req.ip}:${emailOf(req)}`);
export const registerByEmailLimit = rateLimit(rules.registerByEmail, (req) => emailOf(req) || null);
export const loginByEmailLimit = rateLimit(rules.loginByEmail, (req) => emailOf(req) || null);
export const registerLimit = rateLimit(rules.register, (req) => req.ip ?? 'unknown');
export const createIncidentLimit = rateLimit(rules.createIncident, (req) => req.auth!.userId);
export const simulateLimit = rateLimit(rules.simulate, (req) => req.auth!.userId);
export const ingestLogsLimit = rateLimit(rules.ingestLogs, (req) => req.auth!.organizationId);
export const aiAnalysisLimit = rateLimit(rules.aiAnalysis, (req) => req.auth!.userId);
export const alertsLimit = rateLimit(rules.alerts, (req) => req.apiKey?.id ?? req.ip ?? 'unknown');
