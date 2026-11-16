# infra

Everything that defines the machines and how Lift runs on them. **Owner:** WS4 Infrastructure & worker. **Spec:** [docs/prd/04-infrastructure.md](../docs/prd/04-infrastructure.md). Changes here follow the interface rule.

| Folder | What goes here | Today |
| --- | --- | --- |
| `compose/` | `dev.yml` (local stack), `control.yml` and `worker.yml` (the two VMs) | `dev.yml` with Postgres 17 and Redis 7; INF-06 adds BuildKit and the `*.apps.localhost` Traefik |
| `terraform/` | AWS (two EC2 instances, security groups, Elastic IPs, budget) and Cloudflare DNS | INF-01 |
| `traefik/` | Static and dynamic config for both routers | INF-02, INF-03 |
| `scripts/` | Bootstrap, deploy, firewall, start and stop; `dev-env.mjs` behind `pnpm env:init` | `dev-env.mjs` |

The runbook (bootstrap from nothing, rotate secrets, restore a backup, replace the worker) lands with INF-15.
