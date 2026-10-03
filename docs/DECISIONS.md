# Design decisions

## Phase 1: Foundation

### Express 5 for the API

Express 5 forwards rejected promises from async handlers to the error handler, so route code needs no try/catch wrappers. Structured logging is a small request middleware that attaches a pino child logger (`request_id`, then `user_id` and `org_id` after auth) to each request. Tests use supertest against the real Postgres.

### Repository layout

`backend/`, `frontend/` and `shared/` in one pnpm workspace repository (a monorepo, not a monolith: they deploy separately).

### Same-origin API via a Next.js rewrite

The browser only talks to the web origin; `/api/*` is proxied to the API by `next.config.mjs`. The auth cookie is therefore first-party and `SameSite=Lax` works in production even when the web app and API are hosted on different domains (for example Vercel and Render). Socket.IO will use the same path in Phase 4.

### Organization comes from the signed token and a live membership row

The JWT carries `sub` (user) and `org`. On every request `requireAuth` re-reads the membership for that pair, so removing a member or changing a role takes effect immediately, and a client can never choose its own organization.

### Role rules

- Ranking: OWNER > ADMIN > ENGINEER > VIEWER.
- An ADMIN cannot grant OWNER, and cannot modify an OWNER.
- The last OWNER of an organization cannot be demoted (`LAST_OWNER`).
- Another organization's member id returns 404, not 403, so ids do not leak.

### No user enumeration on login

Unknown email and wrong password return the same 401 body, and an argon2 verify against a dummy hash runs for unknown emails so timing is comparable.

### Standard error shape

`{ error: { code, message, requestId, details? } }` for every error, including 404s, malformed JSON and body-size errors. Unknown errors become a generic 500 in production with no stack trace.

### Local ports

Compose publishes Postgres on 5455 and Redis on 6390, the API listens on 4100 and the web app on 3140, to avoid clashing with other local projects on the default ports.

### Tooling beyond the approved list

`tsx` (run TypeScript in dev), `cookie-parser`, `@tailwindcss/postcss` and `postcss` (required by Tailwind 4), `@types/*`, `globals` (ESLint). Tests use supertest.

## Phase 2: Core domain

### Optimistic concurrency with a version column

Every incident change (update, assign, status) must send the `version` it read. The write is `UPDATE ... WHERE id = ? AND organization_id = ? AND version = ?` and increments the version, so concurrent writers cannot silently overwrite each other; zero rows updated means `409 VERSION_CONFLICT`. This avoids holding row locks while a user thinks, and is cheap to test: a five-way simultaneous update test shows exactly one winner. Comments do not touch the incident row, so they do not need or bump a version.

### Two distinct 409s, stale version checked first

`INVALID_STATUS_TRANSITION` (the move is not allowed from the current state; carries `from`, `to`, `allowed`) is separate from `VERSION_CONFLICT` (the client's view is out of date; carries `currentVersion`). If both apply, the version conflict wins, because the client should reload before anything else.

### One transition map shared by API and UI

The lifecycle lives in `shared/` as plain data and the backend `stateMachine.ts` is a pure function over it. The API also returns `allowedNextStatuses` on every incident, so the UI offers only valid buttons without duplicating rules.

### Timeline and audit log are written in the same transaction as the change

Each write inserts the incident change, an `incident_events` row (what users see) and an `audit_logs` row (who, from which IP and user agent) in one transaction, so a failure in any of them rolls back all of them. The timeline is the product view; the audit log is the compliance record and also covers project and service changes.

### Tenant scoping

Every tenant table carries `organization_id` and every query filters on it, including child tables (events, comments). A resource in another organization returns 404 rather than 403 so ids do not leak. Assignees and services must belong to the caller's organization.

### Database-level guard for `resolved_at`

A CHECK constraint forbids `resolved_at` unless the status is RESOLVED or CLOSED, so a bug in application code cannot produce an inconsistent row. CLOSED keeps the original `resolved_at`.

### Priority values and append-only comments

Priority is LOW, MEDIUM, HIGH or URGENT. Comments are append-only in this phase (no edit or delete). Projects and services have no delete endpoint; deleting would cascade to incidents.

### Pagination

Offset pagination (`page`, `limit` up to 100) returning `{ items, page, limit, total }` for projects, services and incidents, ordered by a stable key. Cursor pagination is reserved for logs in Phase 4, where volume justifies it.
