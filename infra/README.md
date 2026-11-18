# infra

Everything that defines the machines and how Lift runs on them. **Owner:** WS4 Infrastructure & worker. **Spec:** [docs/prd/04-infrastructure.md](../docs/prd/04-infrastructure.md). Changes here follow the interface rule.

| Folder | What goes here | Requirement |
| --- | --- | --- |
| `terraform/` | AWS (two EC2 instances, security groups, Elastic IPs, SSM instance profiles, the GitHub deploy role, budget) and Cloudflare DNS | INF-01 |
| `compose/` | `dev.yml` (local stack), `control.yml` and `worker.yml` (the two VMs), and the `*.env.example` key lists for each VM's `/opt/lift/.env` | INF-02, INF-03, INF-06 |
| `traefik/` | Static and dynamic config for both routers | INF-02, INF-03 |
| `docker/` | The Dockerfile for the six platform images | INF-07 |
| `scripts/` | `lift-release.sh` (runs a release on a VM), `ssm-deploy.sh` (rolls a release out through SSM), `dev-env.mjs` behind `pnpm env:init` | INF-02, INF-03, INF-07 |

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
