# Two-minute demo script

A storyboard to record from. Start with `pnpm db:seed` on a clean database, the backend, worker and
frontend running, and the demo shop ready (`pnpm demo:shop`). Use two browser windows side by side:
call them **A** (the one you drive) and **B** (a second signed-in responder).

| Time | On screen                                                                  | Say                                                                                                                                                                      |
| ---- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0:00 | Login page, click **Sign in** as `demo-admin@opsflow.demo`                 | "OpsFlow is incident management: what happens after monitoring says something is wrong."                                                                                 |
| 0:10 | Dashboard, all services healthy                                            | "Five services, healthy. I'll break one the way it actually breaks: a bad deploy."                                                                                       |
| 0:20 | Terminal: `curl -X POST localhost:5050/admin/deploy-bad`                   | "This is a small shop that reports to OpsFlow with an API key. It just shipped v2.4.0, which leaks database connections."                                                |
| 0:30 | Window A: a new incident appears on its own; open it                       | "Nobody clicked anything. The shop's alert rule fired a webhook and OpsFlow opened this incident, de-duplicated, with the right service."                                |
| 0:45 | Incident page: deployments panel, then logs                                | "It linked the deployment from fifteen minutes ago automatically, and these are the real error logs: connection pool exhausted."                                         |
| 1:00 | Click **Analyze with AI**; progress steps tick                             | "Analysis runs in a background job: it gathers context, searches our runbooks with vector search, and asks the model. This is the offline analyzer, and the UI says so." |
| 1:15 | Result card                                                                | "Likely cause, confidence, and the evidence it used, citing the deployment and the log pattern. It only suggests; a person acts."                                        |
| 1:25 | Window B: assign the incident to engineer; change status to INVESTIGATING  | "Window B is a second responder. Watch window A."                                                                                                                        |
| 1:35 | Window A updates live; show the timeline                                   | "Live over WebSockets, and every change is in the timeline and the audit log."                                                                                           |
| 1:45 | In B, try to change status using the old page after A already changed it   | "Optimistic locking: two people can't overwrite each other silently." (Only if time allows.)                                                                             |
| 1:50 | Terminal: `curl -X POST localhost:5050/admin/rollback`; click **Resolved** | "Roll back, resolve. The incident, its evidence and the analysis stay as the record."                                                                                    |
| 2:00 | End on the README architecture diagram                                     | "Express, Postgres with pgvector, Redis and BullMQ, Next.js. Tests run against the real database, and CI builds the Docker images."                                      |

## Notes

- Rehearse once: the alert takes several seconds to fire after the bad deploy, so start talking about the architecture while you wait.
- If you cannot show two windows, skip 1:25 to 1:45.
- Do not say "deployed" or give a live URL unless you have verified the Render deployment with the checklist in [DEPLOYMENT.md](DEPLOYMENT.md).
- To demo the public sign-in instead, run the stack with `DEMO_MODE=true` and click **Try the live demo** at 0:00.
