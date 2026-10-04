# Talking about OpsFlow

## The 30-second version

"OpsFlow is an incident management platform. A monitoring alert or a webhook opens an incident,
OpsFlow links the deployments that happened just before, and responders work it together with live
updates, a timeline, and an audit log. It can also read the incident's logs and your runbooks and
suggest likely causes. I built the backend in Express and Postgres, with Redis for queues and
real-time fan-out, and a Next.js frontend. I wrote it in phases, and every phase had tests against a
real database."

## Resume bullets (accurate as of this repository)

- Built an incident-management platform (TypeScript, Express, Postgres, Redis, Next.js) with role-based
  access, a strict incident lifecycle, optimistic concurrency, and a transactional timeline and audit log.
- Designed an asynchronous job pipeline on BullMQ with retries and idempotent handlers; domain events
  publish after commit and fan out to browsers over Socket.IO through Redis pub/sub.
- Implemented machine integrations: hashed, scoped API keys and Alertmanager/Grafana-compatible webhooks,
  with alert de-duplication enforced by a partial unique index and verified under concurrent delivery.
- Added AI-assisted root-cause suggestions: pgvector retrieval over runbooks, versioned prompts,
  schema-validated model output with a repair step, per-run cost tracking, and an offline provider.
- Wrote a test suite that runs against real Postgres and Redis, plus a CI pipeline that also builds
  the Docker images; hardened the API with rate limiting, CSRF and CORS controls, and graceful shutdown.

Check the current test count with `pnpm test` before quoting a number.

## Do not claim

- That it is deployed or has users. It is not deployed unless you have done it and checked the list in [DEPLOYMENT.md](DEPLOYMENT.md).
- That the Gemini integration has been exercised against the live API. It is tested against a local stub.
- Production scale or benchmarks. There are none.
- That the AI "finds root causes". It suggests candidates with evidence; the default provider is a rule-based stand-in.

## Questions you should expect

**Why optimistic locking, not row locks?**
Incident edits are decided by people reading a screen, so a lock would be held across human think time.
A version column makes the write conditional (`WHERE version = ?`); a loser gets a 409 and a clear message.
See ADR-2.

**How do you make sure a worker does not process the same event twice?**
Delivery is at-least-once, so handlers are idempotent: a key is inserted in the same transaction as the
work, and a duplicate insert means the work already happened. Events are published only after the
originating transaction commits. The honest gap: if the process dies between commit and publish the event
is lost. The fix is an outbox table, and I know where it would go.

**How does a duplicate alert not create two incidents when two arrive at once?**
A partial unique index on (organization, fingerprint) for open incidents. Both inserts race, the loser
catches the unique violation and attaches to the winner. A test fires six concurrently.

**Why store API keys as a plain SHA-256?**
The key is 256 random bits, so there is nothing to guess; a slow hash such as argon2 protects low-entropy
passwords and would only slow every ingest request. Passwords do use argon2.

**How does the AI part avoid being dangerous or wrong?**
It is advisory only, runs as a background job, and its output must match a schema or it is rejected after
one repair attempt. Context is capped and redacted before it is sent. The UI shows confidence, evidence,
model, prompt version and cost, and says plainly when the answer came from the offline analyzer.

**Why pgvector and not Pinecone or similar?**
Hundreds of chunks per organization. One database, transactional with the runbooks, with the tenant filter
in the same query. See ADR-3.

**How is multi-tenancy enforced?**
Organization comes from the signed token plus a live membership row, never from a client header, and every
repository query filters by it. Tests check that another organization's ids are indistinguishable from
"not found".

**What would break first at scale?**
The embedded-worker mode (jobs share the API's CPU), a single Redis, and dashboard queries on very large
logs tables. The first two are configuration changes; the third needs partitioning by time.

**What bug taught you the most?**
Pick one you actually remember. Good real ones from this repo: the grid child that stretched the whole page
because `min-width: auto` (found only at a 375px viewport); logs tagged only by incident id left
alert-created incidents with an empty log panel (found by running the demo shop, not by tests); a quadratic
email-redaction regex found when bounding the context builder.

**What would you do next?**
An outbox for event publishing, on-call schedules and paging, SLO and post-mortem views, and a measured
load test before making any scale claims.
