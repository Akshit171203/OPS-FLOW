# OpsFlow

Incident management for engineering teams: incidents with a strict lifecycle, live timelines, logs and deployments, and optional AI-assisted analysis.

Status: Phase 1 (foundation) complete — registration, login, organizations, roles and RBAC.

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
pnpm dev:backend   # http://localhost:4100
pnpm dev:frontend  # http://localhost:3140
```

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Tests run against the real Postgres from Docker Compose (database `opsflow_test`, created automatically).

Design decisions are recorded in [docs/DECISIONS.md](docs/DECISIONS.md).
