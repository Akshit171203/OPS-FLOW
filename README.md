# OpsFlow

Incident management for engineering teams: incidents with a strict lifecycle, live timelines, logs and deployments, and optional AI-assisted analysis.

Status: Integrations complete: real services connect with API keys, alerts open incidents automatically (Alertmanager, Grafana or plain webhooks), deployments, logs and metrics flow in, on top of Phase 7 (frontend polish) — dashboard, app shell, services and runbooks pages, designed loading/empty/error states, accessible and mobile friendly, on top of Phase 6 (AI incident analysis) — retrieval over runbooks, validated structured output, async analysis with live progress and usage tracking, on top of Phase 5 (Redis hardening and security) — rate limiting, caching, locks, CSRF/CORS, readiness and graceful shutdown, on top of Phase 4 (realtime and operational data) — live incident pages, logs, deployments, metrics and a seeded demo, on top of Phase 3 (async backbone) — events are published after commit and processed by a separate worker with retries and idempotency, on top of Phase 2 (core domain) — incidents with a strict lifecycle, timeline, audit trail and optimistic concurrency, on top of auth and RBAC.

## Structure

- `backend/` — Express + TypeScript API (Drizzle ORM, Postgres, Redis)
- `frontend/` — Next.js web app
- `shared/` — Zod schemas and types used by both

## Run locally

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm db:migrate
pnpm db:seed       # optional: demo organization and data
pnpm dev:backend   # http://localhost:4100
pnpm dev:worker    # background worker (notifications)
pnpm dev:frontend  # http://localhost:3140
```

To run the API and worker as containers instead: `docker compose --profile app up --build`.

## Demo

After `pnpm db:seed`, sign in as one of these (password `demo-password-1`) and use **Simulate payment outage** on the Incidents page: it creates a believable outage (error logs, degraded metrics, the v2.4.0 deployment) that updates live in every open window.

| Role     | Email                      |
| -------- | -------------------------- |
| OWNER    | demo-owner@opsflow.demo    |
| ADMIN    | demo-admin@opsflow.demo    |
| ENGINEER | demo-engineer@opsflow.demo |
| VIEWER   | demo-viewer@opsflow.demo   |

## Connect a real service

OpsFlow receives alerts, deployments, logs and metrics from your own systems with **API keys** (Integrations page). Full guide: [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

To see it with no wiring, run the demo shop and crash it (OpsFlow running and seeded):

```bash
pnpm demo:shop                                   # a small website that reports to OpsFlow
curl -X POST localhost:5050/admin/deploy-bad     # a bad deploy: within seconds an incident opens by itself
curl -X POST localhost:5050/admin/rollback       # fix it
```

## AI analysis

Open an incident and press **Analyze with AI**. It reads the incident's logs, deployments and metrics plus your runbooks, and returns likely causes with confidence, evidence and suggested steps.

- By default `AI_PROVIDER=fake`: an offline analyzer that needs no key and is labelled as such in the UI.
- For a real model set `AI_PROVIDER=gemini` and `GEMINI_API_KEY` on the server (never in the browser), then run **POST /api/runbooks/reindex-all** once so the runbooks are embedded with the same model.
- With the key missing, the analysis shows a clear failed state and the rest of the app works normally.
- Runbooks are managed through the API (`/api/runbooks`); five are seeded by `pnpm db:seed`.

## API notes

- State-changing requests that use the session cookie must send `X-Requested-With: opsflow` (the web app does this automatically), for example `curl -X POST ... -H 'x-requested-with: opsflow' -H 'cookie: opsflow_token=...'`.
- `GET /health` is liveness; `GET /ready` reports Postgres and Redis (503 if either is down or the process is shutting down).
- Rate limits return `429` with a `Retry-After` header.
- Set `TRUST_PROXY` to the number of reverse proxies in front of the API (1 for the Next.js rewrite), and make sure the API is only reachable through them.

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @opsflow/frontend check:contrast   # design-token colour pairs meet WCAG AA
```

Tests run against the real Postgres from Docker Compose (database `opsflow_test`, created automatically).

Design decisions are recorded in [docs/DECISIONS.md](docs/DECISIONS.md).
