export interface SeedRunbook {
  title: string;
  serviceTag: string | null;
  content: string;
}

/** Realistic on-call runbooks. The payment and database ones describe the demo outage (pool exhaustion after a rollout). */
export const SEED_RUNBOOKS: SeedRunbook[] = [
  {
    title: 'Payment service troubleshooting',
    serviceTag: 'payment-service',
    content: `# Payment service troubleshooting

## Symptoms
Checkout failures, payment authorization timeouts, a sudden rise in the payment error rate, or customers reporting "payment could not be processed". Check the payment dashboard for error rate above 5% and p95 latency above one second.

## First checks
1. Look at the most recent deployments of payment-service. Failures that start within minutes of a rollout point to a regression in that release.
2. Search the payment logs for "Connection pool exhausted" or "Timeout acquiring database connection". These mean the service cannot get a database connection and every request that needs one will fail.
3. Compare traffic (requests per minute) with the usual level. A drop in traffic together with a rise in errors usually means customers are failing at checkout.

## Connection pool exhaustion
If the logs show the pool is exhausted (active equals max, with requests waiting), the cause is usually a recent change to pool size, query behaviour or connection handling. Inspect long-running queries and check whether connections are being released. Do not raise the pool maximum without confirming the database connection limit; doing so can take the database itself down. Raising limits or restarting pods requires approval from the on-call lead.

## Mitigation
If a deployment is the likely cause, roll back to the previous version using the deployment rollback runbook. Rolling back production requires explicit human approval. After rollback, confirm the error rate returns to normal within five minutes.

## After the incident
Record the root cause, the release that introduced it, and add a regression test or alert for pool saturation.`,
  },
  {
    title: 'Database connection issues',
    serviceTag: null,
    content: `# Database connection issues

## Overview
Services reach PostgreSQL through connection pools. Problems show up as timeouts acquiring a connection, "too many clients", slow queries, or pool exhaustion.

## Diagnosing pool exhaustion
A pool is exhausted when every connection is checked out and new requests wait. Look for log lines such as "Connection pool exhausted: active=50 max=50 waiting=12". Causes include a pool that is too small for the traffic, queries that run too long, transactions left open, or connections that are never returned.

## Useful checks
Run \`SELECT state, count(*) FROM pg_stat_activity GROUP BY state\` to see active and idle-in-transaction connections. Find slow statements with \`SELECT pid, now() - query_start AS runtime, query FROM pg_stat_activity WHERE state = 'active' ORDER BY runtime DESC\`. Compare the sum of all service pool maximums against the database max_connections setting.

## Safe remediation
Prefer fixing the cause (a slow query, a leak, a recent release) over raising limits. Terminating backends or raising max_connections are risky production changes and require human approval. If a recent deployment changed pool or timeout settings, rolling it back is usually the fastest safe mitigation.

## Prevention
Alert on pool saturation above 80%, set statement timeouts, and keep the total of all pool maximums below the database connection limit.`,
  },
  {
    title: 'Authentication failures',
    serviceTag: 'auth-service',
    content: `# Authentication failures

## Symptoms
Users cannot sign in, sessions end unexpectedly, or login returns 401 or 429 responses in large numbers.

## Checks
1. Look at the auth service error rate and latency. A spike in 401 responses can be a real credential problem or an expired signing secret.
2. Check whether the JWT signing secret or token lifetime was changed in a recent deployment. Rotating the secret without a grace period signs everyone out.
3. A burst of 429 responses means the login rate limit is being hit. Look for credential stuffing from a small set of IP addresses before raising any limit.

## Mitigation
Revert the secret or token configuration if a deployment changed it. For an attack, block the offending sources at the edge. Changing production secrets and disabling rate limits both require human approval.

## Verification
After the fix, sign in with a test account, confirm sessions persist, and watch the 401 rate return to baseline.`,
  },
  {
    title: 'Redis failures',
    serviceTag: null,
    content: `# Redis failures

## What depends on Redis
The job queues, the rate limiter, the cache, distributed locks and realtime fan-out all use Redis. The API stays up when Redis is down but degrades: rate limiting is skipped, the cache falls back to the database, and live updates stop.

## Symptoms
The readiness endpoint reports redis as failed, jobs stop being processed, notifications are delayed, and logs show connection errors to Redis.

## Checks
Confirm Redis is reachable and responding with PING. Check memory usage and the eviction policy: a full instance with a noeviction policy rejects writes. Look at connection counts for a client leak.

## Mitigation
Restart a crashed Redis instance and wait for the API to report ready again. Queued jobs are kept and resume once it returns. Do not flush Redis in production: it deletes queued jobs. Any flush or failover needs human approval.

## After recovery
Check the failed jobs list for work that exhausted its retries during the outage and re-run it.`,
  },
  {
    title: 'Deployment rollback',
    serviceTag: null,
    content: `# Deployment rollback

## When to roll back
Roll back when a new release is the most likely cause of an incident: errors or latency began within minutes of the rollout and the previous version was healthy. Rolling back is safer than debugging forward during an outage.

## Before you roll back
1. Identify the last known good version from the deployment history.
2. Confirm the release has no database migration that the previous version cannot run against. If it does, stop and ask the owning team.
3. Get explicit approval from the on-call lead. A production rollback is a significant change and must never be done on assumption.

## Procedure
Redeploy the previous version through the normal pipeline, not by editing running servers. Watch the error rate, latency and pool metrics for five minutes. Record the rollback on the incident timeline and link the deployment to the incident.

## After the rollback
Keep the incident open until metrics are stable, write down the suspected cause, and track the fix in a follow-up rather than redeploying the same release.`,
  },
];
