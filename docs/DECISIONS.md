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

## Phase 4: Realtime and operational data

### Redis pub/sub between processes, Socket.IO only in the API

Workers run in a separate process and cannot hold sockets. Instead of the Socket.IO Redis adapter, every producer (the API after a commit, or the worker after creating notifications) publishes a small validated envelope `{ rooms, event, data }` to one Redis channel, and every API instance subscribes and re-emits to its connected sockets. This uses only ioredis, needs no extra dependency, scales to several API instances (each subscribes), and lets any future process push live updates. Malformed messages are dropped and logged, never forwarded.

### Incident events go out from the API, `notification.created` from the worker

Incident changes are pushed to browsers directly after the commit, in parallel with queuing the domain event for the worker, so live updates do not depend on the worker being up. Only `notification.created` comes from the worker, because the worker is what creates notifications. Realtime is deliberately best effort: failures are logged, never thrown, and the pages refetch after a socket reconnect. The database remains the source of truth.

### Socket authentication and rooms

The handshake reads the same HttpOnly session cookie and re-checks organization membership in the database (shared with the HTTP middleware, so there is one definition of "authenticated"). Each socket joins `org:<id>` and `user:<id>` automatically from its verified identity. Clients cannot name rooms: the only way into an incident room is `incident:join`, which checks the incident belongs to the caller's organization and answers another tenant's incident with the same "not found" as a missing one. Known limit: a socket keeps its rooms until it disconnects, so removing a member does not drop their live connection immediately.

### Same-origin socket path

The socket lives at `/api/socket.io`, under the existing `/api` rewrite, so it uses the first-party cookie and works behind the Next proxy for both polling and websocket. Next's rewrite drops trailing slashes, so Socket.IO's default `/api/socket.io/` returned 404 through the proxy; both server and client set `addTrailingSlash: false`.

### Log timestamps are set from JavaScript, pagination is keyset

Logs are listed newest first with an opaque cursor over `(timestamp, id)`: stable under concurrent inserts and constant cost per page, unlike OFFSET. Postgres `now()` has microsecond precision but a cursor carries a JavaScript millisecond timestamp, which would make rows with the same millisecond skip or repeat across pages; so ingestion always sets the timestamp explicitly in JavaScript. The ID tiebreak is covered by a test with ten rows sharing one timestamp. Text search is `ILIKE` with `%`, `_` and `\` escaped; a trigram index is the next step if volume grows.

### Batch ingestion is all or nothing

A batch is capped at 500 entries and validated as a whole (every service and incident must belong to the caller's organization) before a single insert, so a rejected batch stores nothing.

### Metrics mirror health onto the service, newest wins

A new snapshot updates the service status only if it is at least as new as the latest one, so a late-arriving old snapshot cannot overwrite current health. When the sender gives no health label it is derived: error rate at least 50% is DOWN, at least 5% or latency at least one second is DEGRADED, otherwise HEALTHY.

### Deployment linking

A deployment must belong to the same service and organization as the incident, each pair can be linked once (409 `ALREADY_LINKED`), and linking writes a timeline event and an audit log in one transaction. The incident's deployment list uses a window before the incident's start (default 48 hours) and reports which entries are already linked.

### Simulate reuses the real code paths

The Simulate endpoint (ADMIN and above) calls the same service functions as normal use (create incident, ingest logs, ingest metrics, create and link a deployment), so events, notifications, the timeline, the audit log and live updates behave exactly as in real use. It records v2.4.0 as deployed 15 minutes earlier, reuses a recent v2.4.0 if one exists, and creates the project and payment service when an organization has none, so the button works anywhere. Two thirds of the outage's error lines are connection pool exhaustion. The seed supplies the baseline (users per role, five services, a week of hourly healthy metrics, deployment history, about fifty routine log lines) so that the outage itself can be replayed on demand.

### Seed safety

`pnpm db:seed` recreates the demo organization from scratch (repeatable), refuses to run when `NODE_ENV=production`, and uses a published demo password for demo-only accounts.
