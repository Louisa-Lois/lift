# infra

Everything that defines the machines and how Lift runs on them. **Owner:** WS4 Infrastructure & worker. **Spec:** [docs/prd/04-infrastructure.md](../docs/prd/04-infrastructure.md). Changes here follow the interface rule.

| Folder | What goes here | Requirement |
| --- | --- | --- |
| `terraform/` | AWS (two EC2 instances, security groups, Elastic IPs, SSM instance profiles, the GitHub deploy role, budget) and Cloudflare DNS | INF-01 |
| `compose/` | `dev.yml` (local stack), `control.yml` and `worker.yml` (the two VMs), and the `*.env.example` key lists for each VM's `/opt/lift/.env` | INF-02, INF-03, INF-06 |
| `traefik/` | Static and dynamic config for both routers, and the local one | INF-02, INF-03, INF-06 |
| `docker/` | The Dockerfile for the six platform images | INF-07 |
| `scripts/` | `lift-release.sh` (runs a release on a VM), `ssm-deploy.sh` (rolls a release out through SSM), `dev-env.mjs` behind `pnpm env:init` | INF-02, INF-03, INF-07 |

## The local stack

`pnpm stack:up` starts `compose/dev.yml`: Postgres and Redis for the apps, plus BuildKit, a Traefik for `*.apps.localhost` and `lift-probe` for the worker. The worker runs on your machine with `pnpm dev` and deploys apps the way it does on the worker VM, over plain HTTP instead of HTTPS.

| Port on 127.0.0.1 | What | To move it |
| --- | --- | --- |
| 5432 | Postgres (user, password and database `lift`) | `LIFT_PG_PORT`, and `DATABASE_URL` in `.env` |
| 6379 | Redis | `LIFT_REDIS_PORT`, and `REDIS_URL` |
| 1234 | BuildKit | `LIFT_BUILDKIT_PORT`, and `BUILDKIT_HOST` |
| 80 | Deployed apps at `http://{service}-{project}.apps.localhost` | `LIFT_APPS_PORT`; apps then need the port in their URL |
| 8080 | Traefik's dashboard at http://localhost:8080/dashboard/ | `LIFT_TRAEFIK_PORT` |

- **Port 80 taken,** for example by XAMPP's Apache? Stop it while you work on Lift, or run `LIFT_APPS_PORT=8880 pnpm stack:up` and open apps at `http://…apps.localhost:8880`.
- **`*.localhost` names** resolve to your own machine in Chrome, Firefox and curl, so there's no DNS to set up. Safari may not resolve them; use Chrome, or `curl -H 'Host: web-demo-shop.apps.localhost' http://127.0.0.1/`.
- **Before `pnpm stack:down`,** run `pnpm --filter @lift/worker clean`. It removes the app containers and project networks the worker created; they keep running otherwise, and `lift-edge` can't be removed while they're attached.
- **`lift-probe`** exists because a process on your Mac can't reach container IPs. The worker checks a new app's health with `docker exec lift-probe curl …`, the same way on the worker VM.

## How a deploy reaches the VMs

There is no SSH. `.github/workflows/deploy.yml` builds `ghcr.io/{owner}/lift-{web,api,collab,agent,mcp,worker}:{sha}`, assumes the `lift-github-deploy` role by OIDC, and calls `scripts/ssm-deploy.sh`, which sends shell commands through SSM Run Command:

1. **stage**, on both VMs at once: unpack `compose/`, `traefik/` and `scripts/` into `/opt/lift/releases/{sha}`, check `/opt/lift/.env` has every key, pull the images.
2. **migrate**, on the control plane: `api migrate` as a one-off container.
3. **up**, on the control plane and then the worker: `docker compose up -d --wait`, then point `/opt/lift/current` at the release.

At boot, `lift.service` runs `lift-release.sh boot` for whatever `/opt/lift/current` points at.

## Working on a VM

```bash
terraform -chdir=infra/terraform output shell                    # the session command for each VM
aws ssm start-session --profile lift --target i-…                # then, on the VM:
sudo /opt/lift/current/scripts/lift-release.sh compose ps
sudo /opt/lift/current/scripts/lift-release.sh compose logs -f api
sudo nano /opt/lift/.env                                         # secrets; keys in compose/*.env.example
```

The full runbook (bootstrap from nothing, rotate secrets, restore a backup, replace the worker) lands with INF-15.
