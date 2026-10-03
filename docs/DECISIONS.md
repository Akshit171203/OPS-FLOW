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

## Phase 3: Async backbone

### Events are published after commit; failures are logged and counted, not retried inline

`publishEvent()` runs only after the database transaction has resolved, so a worker can never see an event for data that was rolled back. If the Redis publish fails (or takes more than 2 seconds) the request still succeeds, because the data is already committed; the failure is logged at error level with the event and request ids, and counted in a process-local counter that the admin jobs endpoint returns as `publishFailures`. The counter is deliberately not stored in Redis, since Redis may be what is down. The remaining gap (a crash between commit and publish loses the event) is the classic dual-write problem. The outbox pattern closes it by writing the event to a table in the same transaction and relaying it; it is a known V2 improvement and not built.

### Idempotency key and work share one transaction

`processOnce(key, scope, fn)` inserts the key with `ON CONFLICT DO NOTHING` and runs `fn` inside the same transaction. If `fn` throws, the key rolls back, so the retry runs again; recording the key in its own committed transaction would turn one transient failure into a permanently skipped event. Concurrent deliveries serialize on the unique index, so exactly one runs the work. `notifications(event_id, user_id)` is unique as a second, independent guard, and BullMQ `jobId = eventId` stops duplicate enqueues. Three layers because each covers a different failure: duplicate enqueue, concurrent consumers, and a retry after a partial failure.

### Redis is the queue, Postgres stays the source of truth

BullMQ keeps jobs in Redis, so jobs published while the worker is down wait there and are delivered when it returns (verified by killing the worker container, creating incidents, and restarting it: every notification arrived once). Notifications themselves live in Postgres.

### Retry policy

Three attempts, with delays of 1s and 5s between them. The configured list also holds 30s, which is never used with three attempts; it is clamped so raising the attempt count later cannot index past the end. Delays are an environment setting so tests run in milliseconds. After the last failure the job stays in BullMQ's failed set with its error and attempt count (`removeOnFail: false`). A malformed payload throws `UnrecoverableError`: it can never succeed, so it fails after one attempt instead of burning retries.

### Request correlation

The HTTP `x-request-id` is copied into the event, then into every job log line (`request_id`, `job_id`, `event_id`, attempt, duration) and into the notification row's metadata, so one id traces a notification back to the request that caused it.

### Who is notified

The person who made the change is never notified of it. Created: the assignee and all admins and owners. Assigned: the new assignee. Updated, status changed or commented: the assignee. Resolved: the assignee and the creator. Recipients are filtered to current organization members, so a stale id or another tenant's user can never receive a notification.

### Failed-jobs endpoint is tenant-scoped

`GET /api/admin/jobs/failed` (ADMIN+) filters failed jobs by the organization id carried in each job, so one tenant cannot see another's failures.

### Two processes, one image

The API and the worker are separate entry points (`server.ts`, `worker.ts`) built from one backend image with different commands. The application containers sit behind a Compose `app` profile so a plain `docker compose up` still starts only Postgres and Redis for local development. The Dockerfile is deliberately minimal; production hardening belongs to Phase 8.
