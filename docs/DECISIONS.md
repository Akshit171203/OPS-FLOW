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

## Phase 5: Redis hardening and security

### Sliding-window rate limiter in a Lua script

Each key is a Redis sorted set of hit timestamps. One Lua script drops hits older than the window, counts what is left, and either records the hit or returns how long until the oldest hit expires. It runs atomically (so 310 parallel requests against a limit of 300 admit exactly 300, which a test proves) and uses Redis' own clock, so several API instances agree. A sliding window avoids the burst a fixed window allows at its boundary (up to twice the limit across two adjacent windows) and its memory cost is bounded by the limit. A rejection is `429 RATE_LIMITED` with a whole-seconds `Retry-After`.

### What is limited, and by what key

Login: 5 per minute per IP and email, counting successful attempts too, so it cannot be used as a password oracle. A second, looser login limit of 20 per minute per email alone stops an attacker rotating IP addresses against one account. Incident creation: 20 per minute per user. Simulate: 6 per minute per user. Log ingestion: 300 requests per minute per organization. Registration: 10 per hour per IP. The AI analysis limit (10 per minute per user) is defined but only wired in Phase 6, when that endpoint exists.

### Fail open on Redis errors for rate limits, fail soft for the cache, fail closed for locks

If Redis is unavailable the rate limiter lets the request through and logs the error: losing throttling is a smaller harm than taking the whole API down with Redis. The cache falls back to the database. A lock is not taken silently: acquiring it needs Redis, so the operation errors rather than risking two concurrent runs. Verified against a really stopped Redis container: login and the dashboard kept working, `/ready` reported 503.

### Client IP and `TRUST_PROXY`

`req.ip` is only the real client when the number of proxy hops is configured. `TRUST_PROXY=1` matches the Next.js rewrite in front of the API. Without it every user would share the proxy's address and one person's failed logins would lock everyone out; with too high a value a client could forge `X-Forwarded-For`. The API must therefore not be reachable except through the proxy in production; the per-email backstop limits the damage if it is.

### Read-through cache with TTL and explicit invalidation

`getOrSet(key, ttl, loader)` serves cached JSON or loads and stores it. The dashboard is cached for 30 seconds and the service health view for 15, under `org:<id>:dashboard` and `org:<id>:service-health`, one entry per organization so tenants can never see each other's data. Every write that changes them (incident create or change, metrics snapshot, deployment, service change) invalidates after its commit, so users see their own change immediately. The TTL is the safety net if an invalidation is ever missed or a slow read repopulates just after one: staleness is bounded to the TTL, never indefinite. A cached request makes no database query beyond the authentication check (a test counts the queries).

### Dashboard computed in SQL

Open and critical counts, degraded services, recent deployments and mean resolution time are aggregates in the database, not loops in the application. Service health uses one `LATERAL` query for each service's newest snapshot instead of one query per service.

### Locks: token ownership and a TTL

`SET key token NX PX ttl` takes the lock; release is a Lua compare-and-delete, so a holder whose lock expired cannot free the next holder's lock (tested). The TTL frees the lock if the process dies. It guards Simulate, so a double-click creates one outage and the second request gets `409 LOCK_HELD`. This is a single-instance Redis lock, adequate for preventing duplicate work; it is not a fencing-token design and should not guard anything where a pause longer than the TTL would corrupt data.

### CSRF: custom header plus Origin, on top of SameSite

Session cookies are `HttpOnly` and `SameSite`, and every state-changing request is additionally checked twice: a browser-sent `Origin` must equal the web origin, and a request carrying the session cookie must send `X-Requested-With: opsflow`. A cross-site page cannot add that header without a CORS preflight, which strict CORS refuses. Unauthenticated writes (register, login) carry no session to forge, so they only get the Origin check. Tokens (double submit) would add state and complexity for no extra protection here.

### CORS, WebSockets and headers

CORS allows exactly the web origin with credentials; any other origin receives no CORS headers. WebSockets are not governed by CORS, so the Socket.IO handshake checks `Origin` itself, closing cross-site WebSocket hijacking. Since this is a JSON API, helmet is set to `default-src 'none'`, `frame-ancestors 'none'`, no referrer and same-site resource policy, and every response is `Cache-Control: no-store` so authenticated data is never cached by a browser or proxy.

### Body limits

100 KB for ordinary endpoints; 1 MB for log ingestion only, parsed first so the small limit does not apply to it. Oversized bodies are rejected with `413 PAYLOAD_TOO_LARGE`.

### Cookie flags per environment

`Secure` in production only (so `http://localhost` works in development), `SameSite` and `Domain` from configuration, and logout clears with identical attributes, because a browser ignores a clear that does not match the cookie's domain and path.

### Liveness vs readiness

`/health` says the process is up and checks nothing else, so an orchestrator does not restart a healthy API because Redis blinked. `/ready` checks Postgres and Redis with a 2 second timeout each and returns 503 if either fails, or once shutdown has begun, so load balancers stop routing to an instance that is draining.

### Graceful shutdown

On SIGTERM the API flips `/ready` to 503, stops accepting connections, lets in-flight requests finish, then closes queues, Redis and the database pool in order; a timer forces exit if something hangs. The worker stops taking jobs and waits for active ones. Verified on real processes: with a request deliberately held in flight, new connections were refused, the request still returned 200, and the process then exited. A test also shows a worker stopped mid-job completes that job once, with no retry.

### Database pool

`max` 10, idle clients recycled after 30 s, 5 s to acquire a connection (fail fast instead of queueing forever), and a 15 s server-side `statement_timeout` so a runaway query cannot hold a connection. The API and the worker each have a pool, so Postgres sees up to twice `DB_POOL_MAX`; that stays well below Postgres' default of 100 connections for a few instances. An error event on an idle client is logged instead of crashing the process. All values are environment settings.

## Phase 6: AI incident analysis

### AI is optional and asynchronous

Nothing in the incident workflow depends on the model. "Analyze" returns `202` immediately and a worker does the slow, failure-prone part; the page works the same with the provider down, slow, or never configured. The provider is only constructed by the AI worker and the runbook indexer, so with no key the API process never touches it. Verified by running with `AI_PROVIDER=gemini` and no key: the analysis fails with a clear `AI_NOT_CONFIGURED` message, with no retries, while every other endpoint, creating incidents and changing status keep working.

### One provider interface, no vendor SDK

`AIProvider` has two methods, `analyzeIncident` and `generateEmbedding`, plus the model names (stored with every result and every embedding). The real implementation talks to Google Gemini's REST API with `fetch`: no SDK dependency, a timeout on every call, the key sent in a header from server environment only, and never in a URL, a log, an error message, or a response. Swapping vendors means replacing one file. It is tested against a local stub server (request shape, headers, status mapping, timeouts, empty and blocked replies, wrong-sized embeddings), but it has not been run against the live API in this repository's tests because that needs a key.

### A fake provider that is honest about being fake

`FakeProvider` is the default (`AI_PROVIDER=fake`) so tests are deterministic and the whole flow works offline. Its embedding is feature hashing over words, which matches words, not meaning; its analysis is a heuristic over the evidence it is given. The UI labels its output "offline demo analyzer, not a real AI model" so nobody mistakes a pattern matcher for a model.

### Retrieval: pgvector, HNSW, cosine, model-aware

Runbooks are chunked by heading (merging tiny sections, windows of at most 800 characters with an 80 character overlap, every chunk prefixed with `Title › Heading` so it stands alone) and embedded as 768-dimension vectors. An HNSW index with cosine distance serves nearest-neighbour search, always filtered by organization. Each chunk records which model embedded it and searches only compare vectors from the current model: embeddings from different models live in different spaces, and comparing them returns plausible-looking garbage, so changing provider needs `POST /api/runbooks/reindex-all` and until then retrieval returns nothing instead of nonsense. Known limit: with a filter, pgvector applies it after the index scan, which can return fewer than K rows for a tenant with few chunks among many; at this scale the planner scans exactly, and pgvector 0.8's iterative scan is the fix if it grows.

### Indexing is a job, and edits during indexing cannot be lost

Saving a runbook queues indexing after the commit, with one job per version of the text. The indexer embeds first (slow network calls, no database connection held), then replaces the chunks in one transaction guarded by "the runbook has not changed since I read it". An edit made mid-index makes the old job refuse to write (tested), leaving the runbook `PENDING` for the newer job. Re-indexing always replaces rather than appends, so it is idempotent.

### The context is bounded, redacted and single-tenant

One pure function turns database rows into the only data the model sees. Hard caps: 50 error logs of at most 300 characters, 5 error patterns, 10 deployments, 6 metric snapshots, 3 similar incidents, 3 runbook excerpts, and a 24,000 character ceiling on the whole object, shed least valuable first (older logs, then long excerpts, similar incidents, history) and recorded in a `truncation` note so the model knows the picture is partial. Error patterns are counted over every fetched line, not just the shown ones, so "16 occurrences" is real volume. Every query is scoped by organization. Emails, tokens, API keys, JWTs, passwords and database URLs are redacted from every free-text field before anything is cut to length, so a secret cannot survive by being split at the cut. The context carries no assignee, creator, email or organization id. Redaction is bounded so a pathological log line cannot make it slow; a test found and fixed a quadratic email pattern.

### Prompt design and prompt injection

The prompt is versioned in code (`incident-analysis-v1`, stored on every result). Rules: use only the evidence, state uncertainty, cite what supports each cause, never recommend a destructive action without human approval. Logs and titles are attacker-influenced text, so they sit inside an `<incident_data>` block and the instructions say text in it is data, never instructions. This reduces, but cannot eliminate, prompt injection; the stronger defences are structural: the model cannot call tools or change anything, its output is validated against a schema, and nothing it says is executed.

### Output is never trusted

The reply is parsed (markdown fences and surrounding prose stripped) and validated with Zod: confidence between 0 and 1, at least one piece of evidence per cause, bounded list sizes, unknown fields dropped. If invalid, the model gets exactly one repair attempt that includes what was wrong; if that also fails the analysis is `FAILED` with `AI_INVALID_OUTPUT`. Tokens from both calls are summed, so a failed repair is still counted in the spend.

### Failure handling: stable codes, retry only what can succeed

Provider errors map to distinct codes stored on the analysis: timeout, rate limit (429), unavailable (5xx), auth, bad request, empty response, invalid output, not configured. Transient ones (timeout, 429, 5xx, and unexpected errors such as a database blip) go through the queue's retry policy; permanent ones (bad key, bad request, empty reply, invalid output) fail at once instead of burning retries. An intermediate failure leaves the analysis `RUNNING`, not `FAILED`, while attempts remain. Unexpected errors surface a generic message and log the detail, so internals never reach the user.

### Exactly one active analysis, and exactly one result

Three layers: the per-incident lock serializes the check and the insert, so simultaneous requests share one analysis; a partial unique index (`status IN ('QUEUED','RUNNING')`) makes a second active analysis impossible even if the lock were bypassed; and finishing goes through `processOnce`, so a job delivered twice (or retried) records one result and one timeline entry (tested with two jobs running concurrently). An analysis stuck active for ten minutes (worker died, job lost) is expired as `FAILED` instead of blocking the incident forever, and if queuing the job fails the row is failed on the spot rather than left `QUEUED`.

### Cost and usage

Tokens, latency and an estimated cost are stored on every analysis, including failed ones. The price table is a small constant in code, labelled as an estimate; unknown models and the fake cost nothing. `GET /api/ai/usage` (ADMIN and above, per organization, `?days=`) aggregates it in SQL. The 10 per minute per user limit from Phase 5 is now wired to the endpoint.

### Live progress

The worker publishes `started`, `progress` (collecting context, searching runbooks, generating, repairing), `completed` and `failed` to the organization and incident rooms over the existing Redis channel. The page also refetches after a reconnect, so a missed event costs nothing.

## Phase 7: Frontend polish

### Design tokens in one place, and a check that guards them

Colour lives in a single `@theme` block (`globals.css`): one neutral palette, one accent, and named pairs for the three things users scan by colour: severity SEV1 to SEV4, incident status, and service health. Components use names (`bg-sev1-bg text-sev1-fg`) never raw hex values, so changing a colour is a one-line edit. `pnpm --filter @opsflow/frontend check:contrast` computes the contrast ratio of every foreground and background pair from that file and fails below WCAG AA (4.5:1); all 28 pairs pass today (lowest 4.55:1). A text colour that is nice but unreadable is caught by a command, not by someone squinting.

### Colour is never the only signal

Every badge carries its text ("DEGRADED", "SEV1", "Indexed"), so the information survives colour blindness, a monochrome screen, or a screen reader. Charts are a labelled image with the low, high and latest values stated in text.

### Light theme only

Dark mode is not "free" with a utility-class design: it needs a paired variant on every colour class or a second token set plus a check that it passes contrast too. It was left out rather than half done; the tokens are in place so it can be added by redefining them.

### Every state is designed, not just the happy path

Each data-driven view has four states: a skeleton shaped like the content (with an announced "Loading" region), an empty state that says what to do next, an error state with a retry, and the content. Every mutation reports its result in a toast (success, or the server's own error message), announced through a live region; errors stay longer than successes and can be dismissed. A 404 page and an error boundary cover the rest.

### Accessibility fundamentals

Landmarks (`header`, `nav`, `main`, `aside`), a skip link, labels tied to inputs, `aria-current` on the active navigation item, `aria-busy` and live regions for loading and progress, table headers with scope, a visible 2px focus outline that is never removed, and reduced-motion support (animations are off when the system asks). Menus and the mobile drawer close on Escape, and the drawer returns focus to the button that opened it. This was checked by tabbing through a built app, not only by reading code.

### Mobile-first layout, with one recurring trap

A fixed sidebar on wide screens becomes a slide-over drawer below 1024px; stat cards, lists and the incident page collapse to one column. Testing a 375px viewport found a real bug a desktop view hides: a CSS grid item defaults to `min-width: auto`, so one wide child (the logs table) stretched the whole page to 530px. Grid children that can hold wide content now carry `min-w-0`, and tables scroll inside their own container.

### One chart, hand drawn

The service page shows error rate and latency over 24 hours as a small SVG sparkline: about 60 lines, no dependency. It exists because one picture answers "when did it go wrong" faster than a table, and it makes the demo outage obvious. A charting library would be many times the size for the same result.

### The sticky incident header

On wide screens the incident header (severity, status, assignee, status actions) stays in view while the page scrolls through analysis, logs and deployments; on a phone it scrolls away normally because a sticky block would take much of a small screen.

### Small API additions, each for a specific screen

`recentActivity` on the dashboard (the newest timeline entries across incidents, cached and invalidated with the rest of the dashboard), `GET /api/services/:id`, and `GET /api/services/:id/metrics?hours=` for the chart (oldest first, capped at 500 points). No new tables.
