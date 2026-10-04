import { createHash } from 'node:crypto';
import { z } from 'zod';
import { severities, type Severity } from '@opsflow/shared';

export interface NormalizedAlert {
  /** Service slug, or leave out when the API key is tied to one service. */
  service?: string;
  serviceId?: string;
  title: string;
  severity: Severity;
  description?: string;
  /** Identity of the alert: the same fingerprint while an incident is open means "same problem, attach". */
  fingerprint?: string;
  status: 'firing' | 'resolved';
  source: string;
}

const ALIASES: Record<string, Severity> = {
  sev1: 'SEV1',
  p1: 'SEV1',
  critical: 'SEV1',
  page: 'SEV1',
  fatal: 'SEV1',
  sev2: 'SEV2',
  p2: 'SEV2',
  high: 'SEV2',
  error: 'SEV2',
  major: 'SEV2',
  sev3: 'SEV3',
  p3: 'SEV3',
  warning: 'SEV3',
  warn: 'SEV3',
  medium: 'SEV3',
  sev4: 'SEV4',
  p4: 'SEV4',
  low: 'SEV4',
  info: 'SEV4',
  minor: 'SEV4',
  none: 'SEV4',
};

/** Monitoring tools name severities their own way; map the common ones, default to SEV3 when unspecified. */
export function normalizeSeverity(value: string | undefined): Severity | null {
  if (value === undefined || value.trim() === '') return 'SEV3';
  const v = value.trim().toLowerCase();
  if ((severities as readonly string[]).includes(v.toUpperCase()))
    return v.toUpperCase() as Severity;
  return ALIASES[v] ?? null;
}

const sourceSchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9._-]+$/i, 'letters, numbers, dots, dashes and underscores only');

/** Our own simple alert format. */
export const GenericAlertSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    service: z.string().trim().min(1).max(100).optional(),
    serviceId: z.string().uuid().optional(),
    severity: z.string().trim().max(20).optional(),
    description: z.string().max(5000).optional(),
    fingerprint: z.string().trim().min(1).max(200).optional(),
    status: z.enum(['firing', 'resolved']).default('firing'),
    source: sourceSchema.default('webhook'),
  })
  .transform((a, ctx): NormalizedAlert => {
    const severity = normalizeSeverity(a.severity);
    if (!severity) {
      ctx.addIssue({
        code: 'custom',
        path: ['severity'],
        message: `Unknown severity "${a.severity}". Use SEV1-SEV4, critical, high, warning, low ...`,
      });
      return z.NEVER;
    }
    return { ...a, severity };
  });

const labelMap = z.record(z.string().max(500)).default({});

/** Prometheus Alertmanager's webhook payload; Grafana's alerting webhook uses the same shape. */
export const AlertmanagerSchema = z.object({
  alerts: z
    .array(
      z.object({
        status: z.enum(['firing', 'resolved']).default('firing'),
        labels: labelMap,
        annotations: labelMap,
        fingerprint: z.string().max(200).optional(),
      }),
    )
    .min(1)
    .max(100),
});

export function fromAlertmanager(
  payload: z.infer<typeof AlertmanagerSchema>,
  source: string,
): NormalizedAlert[] {
  return payload.alerts.map((a) => {
    const title = (a.annotations.summary ?? a.labels.alertname ?? 'Alert').slice(0, 200);
    const labelText = Object.entries(a.labels)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    const description = [
      a.annotations.description ?? a.annotations.message,
      labelText ? `Labels: ${labelText}` : undefined,
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 5000);
    // Without an explicit fingerprint, derive a stable one from the labels so repeats of the same alert match
    const stable = Object.entries(a.labels)
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([k, v]) => `${k}=${v}`)
      .join('|');
    return {
      service: a.labels.service ?? a.labels.job ?? a.labels.app,
      title,
      severity: normalizeSeverity(a.labels.severity) ?? 'SEV3',
      description: description || undefined,
      fingerprint: a.fingerprint ?? createHash('sha1').update(stable).digest('hex'),
      status: a.status,
      source,
    };
  });
}

export const sourceFromQuery = (value: unknown): string => {
  const parsed = sourceSchema.safeParse(value);
  return parsed.success ? parsed.data : 'alertmanager';
};
