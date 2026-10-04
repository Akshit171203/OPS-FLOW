# Deploying OpsFlow

Everything here is prepared but **has not been deployed by the author**. The checklist in step 5
is how to find out whether it works on your account.

The repository ships a Render Blueprint ([`render.yaml`](../render.yaml)) that creates Postgres,
Redis, the API and the web app. Render hosts both apps because Vercel cannot proxy WebSockets,
which the live incident updates use.

## What you need

- A Render account and this repository connected to it.
- A GitHub repository (for the CI workflow). CI needs no secrets; it never pushes images.
- Optional: a Gemini API key. Without one the offline analyzer is used and clearly labelled.

## 1. Create the Blueprint

1. In Render choose **New → Blueprint**, pick the repository and the branch to deploy.
2. Render shows the five resources from `render.yaml`. It asks for the values marked `sync: false`:
   `WEB_ORIGIN`, `API_URL` and (optionally) `GEMINI_API_KEY`. The first two depend on URLs that do
   not exist yet, so enter placeholders such as `https://placeholder.invalid` and fix them in step 2.
3. Apply. The first build takes several minutes.

## 2. Fix the two addresses (the chicken and egg)

Each app needs the other's public address, and Render only assigns them on creation.

1. Open `opsflow-api` and copy its URL (for example `https://opsflow-api.onrender.com`).
2. Open `opsflow-web`, set `API_URL` to that URL, and **trigger a manual deploy**. The value is baked
   into the build, so saving the variable alone changes nothing.
3. Copy `opsflow-web`'s URL and set it as `WEB_ORIGIN` on `opsflow-api`. The API restarts on save.

If the service names are taken, Render adds a suffix. Use the URLs it shows, not the ones above.

## 3. Check `TRUST_PROXY`

The Blueprint sets `TRUST_PROXY=3`, my reading of the chain (Render's load balancer → Next.js → Render's
load balancer → API). That count is a **hypothesis until verified**. Sign in once, then run this in
the database shell:

```sql
select ip_address, action, created_at from audit_logs order by created_at desc limit 5;
```

- Your own public address: correct.
- A Render-internal address (10.x or similar): too few hops, lower or raise the number and retry.

This matters because rate limits and audit entries are keyed by that address.

## 4. Demo mode

The Blueprint turns on `DEMO_MODE`. Visitors see **Try the live demo** on the login page and are
signed in as a read-only seeded admin.

- Configuration routes (API keys, members, runbooks, projects, services) return `DEMO_READONLY` for
  demo accounts. Incidents can still be created and worked.
- New AI analyses are capped at `AI_DAILY_CAP` per day (30 in the Blueprint), and demo sessions are
  rate limited per IP.
- Demo data is re-seeded every `DEMO_RESET_HOURS` (12).
- Real accounts registered on the same deployment are not restricted.

For a real deployment set `DEMO_MODE=false`. Production refuses `db:seed` unless demo mode is on.

## 5. Verification checklist

- [ ] `https://<api>/ready` returns 200 (database and Redis reachable).
- [ ] The login page shows **Try the live demo** and it lands on a populated dashboard.
- [ ] The demo banner is visible, and creating an API key is refused with a read-only message.
- [ ] **Simulate incident** (admin) creates an incident, and the incident page updates without reload
      (this proves WebSockets pass through the proxy).
- [ ] Analyze with AI completes (this proves the embedded worker is running).
- [ ] `audit_logs.ip_address` is your address (step 3).
- [ ] A hostile origin is rejected: `curl -i -X POST -H 'Origin: https://evil.example' https://<api>/api/auth/login` returns 403.

## Free-tier limits to expect

| Limit                                    | Effect                           | What to do                                            |
| ---------------------------------------- | -------------------------------- | ----------------------------------------------------- |
| Web services sleep after 15 minutes idle | First visit takes about a minute | Fine for a demo; a paid plan removes it               |
| Postgres expires after 30 days           | The database is deleted          | Upgrade or recreate; demo data re-seeds on boot       |
| Key Value is not persisted               | Queued jobs are lost on restart  | Acceptable for demo; use a paid instance for real use |
| No free background workers               | Workers run inside the API       | `EMBEDDED_WORKERS=true`, already set                  |
| Free instances have little memory        | Heavy load will restart the API  | Use a larger plan                                     |

## Connecting a real service

Create an API key in Settings, then follow [INTEGRATIONS.md](INTEGRATIONS.md). Do this on a
deployment with `DEMO_MODE=false`; demo accounts cannot create keys.

## Other hosts

The images are plain Dockerfiles ([`backend/Dockerfile`](../backend/Dockerfile),
[`frontend/Dockerfile`](../frontend/Dockerfile)), so Railway or Fly.io work the same way: Postgres with
pgvector, Redis, the two services, and the variables in [`.env.production.example`](../.env.production.example).
Keep the API and web on a host that supports WebSockets end to end.

## Running the production images locally

```bash
docker compose --profile app up --build
```

The web app is at http://localhost:3140 and the API at http://localhost:4100. Compose sets
`COOKIE_SECURE=false` because the stack is served over plain http.
