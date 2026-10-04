# Connecting your systems to OpsFlow

OpsFlow does not watch your website itself. Your existing tools (your CI pipeline, your monitoring, your app) send it
three kinds of things, and OpsFlow turns them into incidents with context:

| What                 | Sent by                                                              | Result in OpsFlow                                                           |
| -------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Alerts**           | Prometheus Alertmanager, Grafana, Datadog webhooks, or your own code | An incident opens automatically; repeats attach to it                       |
| **Deployments**      | Your CI/CD pipeline                                                  | "What changed just before this broke?", linked to new incidents             |
| **Logs and metrics** | Your app or a log agent                                              | Evidence on the incident page, service health, and input to the AI analysis |

All of it is authenticated with an **API key**, not a person's login.

## 1. Create an API key

Sign in as an owner or admin, open **Integrations**, name the key (what will use it), choose its permissions and, optionally,
tie it to one service, then press **Create API key**. The key is shown **once**. Copy it into your secret store.

| Permission | Allows                                                            |
| ---------- | ----------------------------------------------------------------- |
| `ingest`   | `POST /api/logs`, `/api/metrics`, `/api/deployments`              |
| `alerts`   | `POST /api/integrations/alerts`, `/api/integrations/alertmanager` |

A key **tied to a service** can only act on that service and can leave the service out of its requests. Prefer one key
per system (for example `payment-ci`, `grafana`) so any one of them can be revoked without disturbing the rest.

Send the key as `Authorization: Bearer ofk_...`. Services are referred to by **slug** (shown on the Services page), for
example `"service": "payment-service"`.

## 2. Send deployments

```bash
curl -X POST https://YOUR-OPSFLOW/api/deployments \
  -H "Authorization: Bearer $OPSFLOW_API_KEY" -H "Content-Type: application/json" \
  -d '{"service":"payment-service","version":"v2.4.0","commitSha":"a1b2c3d","environment":"production"}'
```

Optional: `status` (`SUCCESS`, `FAILED`, `ROLLED_BACK`, `IN_PROGRESS`), `deployedBy`, `deployedAt`.

GitHub Actions step: see the **Integrations** page for a ready-made snippet.

## 3. Send alerts

### Simple format (any tool)

```bash
curl -X POST https://YOUR-OPSFLOW/api/integrations/alerts \
  -H "Authorization: Bearer $OPSFLOW_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "service": "payment-service",
    "title": "High error rate on checkout",
    "severity": "critical",
    "description": "5xx above 5% for 5 minutes",
    "fingerprint": "checkout-error-rate",
    "status": "firing"
  }'
```

| Field         |                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `title`       | required, up to 200 characters                                                                                         |
| `service`     | the service slug. Optional if the key is tied to one service                                                           |
| `severity`    | `SEV1`-`SEV4`, or `critical`, `page`, `high`, `error`, `warning`, `low`, `info`, `P1`-`P4`. Default `SEV3`             |
| `fingerprint` | identifies the alert. The same fingerprint while an incident is open means "same problem". Default: service plus title |
| `status`      | `firing` (default) or `resolved`                                                                                       |
| `source`      | a label such as `grafana`, shown on the incident. Default `webhook`                                                    |
| `description` | optional text for the incident                                                                                         |

What happens:

- **firing, nothing open for this fingerprint** → a new incident opens (`201`, `"action": "created"`). Its priority follows the
  severity, and deployments from the last hour (up to three) are linked to it automatically.
- **firing, an incident is already open** → the alert **attaches** to it (`200`, `"action": "attached"`) and a "fired again"
  note is added to its timeline (at most one a minute). Concurrent copies still produce a single incident.
- **resolved** → a note is added to the incident (`"action": "noted"`). OpsFlow **does not close the incident**: whether the
  problem is truly fixed is a human decision. With nothing open it is ignored (`"action": "ignored"`).
- Once an incident is resolved or closed, the same alert firing again opens a **new** incident.

### Prometheus Alertmanager

```yaml
receivers:
  - name: opsflow
    webhook_configs:
      - url: https://YOUR-OPSFLOW/api/integrations/alertmanager
        send_resolved: true
        http_config:
          authorization:
            type: Bearer
            credentials: ofk_...
route:
  receiver: opsflow
```

Give alerts a `service` (or `job`) label so OpsFlow knows which service they belong to, or use a key tied to one service.
The title comes from `annotations.summary` (or `alertname`), severity from `labels.severity`, and a stable fingerprint is
derived from the labels, so repeats attach to the same incident.

### Grafana

Add a **Webhook** contact point with the URL `https://YOUR-OPSFLOW/api/integrations/alertmanager?source=grafana` and an
`Authorization` header with scheme `Bearer` and your key. Grafana's payload has the same shape as Alertmanager's.

## 4. Send logs and metrics

```bash
curl -X POST https://YOUR-OPSFLOW/api/logs \
  -H "Authorization: Bearer $OPSFLOW_API_KEY" -H "Content-Type: application/json" \
  -d '{"logs":[{"service":"payment-service","level":"ERROR","message":"Connection pool exhausted","requestId":"req-1"}]}'

curl -X POST https://YOUR-OPSFLOW/api/metrics \
  -H "Authorization: Bearer $OPSFLOW_API_KEY" -H "Content-Type: application/json" \
  -d '{"service":"payment-service","errorRate":0.34,"latencyMs":5200,"requestsPerMin":410}'
```

Logs: up to 500 per request, levels `DEBUG`/`INFO`/`WARN`/`ERROR`, optional `timestamp` and `metadata`. The incident page shows
a service's logs from 30 minutes before the incident started. Metrics: `errorRate` is a fraction from 0 to 1; the newest
snapshot sets the service's health (DOWN at 50% errors, DEGRADED at 5% or one second latency, otherwise HEALTHY).

## Limits and errors

|              |                                                                      |
| ------------ | -------------------------------------------------------------------- |
| Logs         | 300 requests per minute per organization, 1 MB per request           |
| Alerts       | 120 per minute per key; 30 _new_ incidents per hour per organization |
| Invalid keys | 30 per minute per IP, then `429`                                     |
| Other bodies | 100 KB                                                               |

Errors use one shape: `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`. Common codes: `INVALID_API_KEY`
(401), `KEY_SCOPE` (403: the key lacks that permission), `KEY_SERVICE_MISMATCH` (403: key tied to a
different service), `UNKNOWN_SERVICE` (400: no such slug in your organization), `SERVICE_REQUIRED` (400), `RATE_LIMITED`
and `AUTO_INCIDENT_LIMIT` (429).

## Security notes

- Only a SHA-256 hash of each key is stored. Keys are 256 bits of randomness, so there is nothing to guess; a lost key cannot be
  recovered, only replaced.
- Revoking a key takes effect on the next request. Every key creation and revocation is in the audit log.
- Each key acts as a hidden service account named after the key, so audit logs and timelines say, for example, "grafana opened
  the incident". These accounts cannot sign in, are not listed as members, cannot be assigned work and receive no notifications.
- Keep keys out of source control. In GitHub use a repository secret.

## Try it without wiring anything: the demo shop

`pnpm demo:shop` starts a small website that reports to OpsFlow the way a real service does. Crash it with
`curl -X POST localhost:5050/admin/deploy-bad` and an incident opens by itself within seconds, with the bad deployment
already linked and the logs and metrics on its page. See `examples/demo-shop/README.md`.
