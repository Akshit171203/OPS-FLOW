# Demo shop

A tiny website you can crash on purpose to watch OpsFlow react. It behaves like a real service would:

- reports each **deployment**
- ships **logs** and **metrics**
- raises an **alert** when its error rate spikes, which opens an incident in OpsFlow

There are no dependencies: you only need Node 22. It generates its own traffic.

## Run it

OpsFlow must be running (`pnpm dev:backend`, `pnpm dev:worker`, `pnpm dev:frontend`) and seeded (`pnpm db:seed`).

```bash
pnpm demo:shop
```

On the first run it signs in as the seeded demo admin, creates the `shop-service` service, and mints an API key
for it automatically (you can see and revoke it under **Integrations**). To connect to your own OpsFlow instead:

```bash
OPSFLOW_URL=https://your-opsflow-url OPSFLOW_API_KEY=ofk_... OPSFLOW_SERVICE=your-service-slug pnpm demo:shop
```

## Crash it

In another terminal:

```bash
curl -X POST localhost:5050/admin/deploy-bad    # deploys v1.1.0, which leaks database connections
```

Within about 30 seconds you will see, in OpsFlow:

1. the shop's error rate and latency jump on the **Services** page,
2. an **incident** open by itself ("Checkout is failing: error rate above 20%"), labelled as an alert,
3. the **v1.1.0 deployment** already linked to it, and connection-pool errors in its logs,
4. press **Analyze with AI** to get likely causes that point at that deployment.

Then fix it:

```bash
curl -X POST localhost:5050/admin/rollback      # back to a healthy version
```

The alert reports "resolved", which adds a note to the incident. Closing it is still up to you.

## Options

| Variable          | Default                 |                                                              |
| ----------------- | ----------------------- | ------------------------------------------------------------ |
| `OPSFLOW_URL`     | `http://localhost:3140` | where OpsFlow is (the web address works: it forwards `/api`) |
| `OPSFLOW_API_KEY` | created for you         | an API key with `ingest` and `alerts`                        |
| `OPSFLOW_SERVICE` | `shop-service`          | the service slug to report as                                |
| `PORT`            | `5050`                  | the shop's own port                                          |
| `TRAFFIC`         | on                      | set to `0` to send your own requests instead                 |
