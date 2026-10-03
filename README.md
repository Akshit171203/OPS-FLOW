# OpsFlow

Incident management for engineering teams: incidents with a strict lifecycle, live timelines, logs and deployments, and optional AI-assisted analysis.

Status: Phase 4 (realtime and operational data) complete — live incident pages, logs, deployments, metrics and a seeded demo, on top of Phase 3 (async backbone) — events are published after commit and processed by a separate worker with retries and idempotency, on top of Phase 2 (core domain) — incidents with a strict lifecycle, timeline, audit trail and optimistic concurrency, on top of auth and RBAC.

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

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Tests run against the real Postgres from Docker Compose (database `opsflow_test`, created automatically).

Design decisions are recorded in [docs/DECISIONS.md](docs/DECISIONS.md).
