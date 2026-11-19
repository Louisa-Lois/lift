# PRD 4 · Infrastructure & worker

> Read together with `docs/contracts.md`. Owner: Hakim, who builds the rest of the demo path too. `docs/start-here.md` has the current dates, which replace the ones below. Paste the kickoff prompt at the bottom into your coding agent to start.

## Goal, scope and inspiration

**WS4 builds the machines and the worker: two AWS virtual machines defined in Terraform, HTTPS routing for the dashboard and every deployed app, and the worker agent that builds images, runs containers safely, ships logs and metrics, and provisions databases.** By Nov 19 a pushed repo is live at its own HTTPS address; by Nov 23 the worker does everything the manual demo needs.

- **Owner:** Hakim, who builds the rest of the demo path too. **Reviewer:** Esbert, for the deploy pipeline.
- **Owns:** `infra/`, `apps/worker`, and `.github/workflows/deploy.yml`.
- **Depends on:** the job and internal-API contracts in `docs/contracts.md`.

| Inspiration | What we take |
| --- | --- |
| Coolify, Dokku, CapRover | A single-VM platform on plain Docker: Traefik routing by container labels, Nixpacks or Railpack builds, servers managed over SSH |
| Railway | Railpack as the builder; private networking between services in a project; health checks before traffic switches |
| Fly.io Machines | A small agent on each host that keeps running containers in line with the desired state |
| Render | Zero-downtime deploys: the new instance passes its health check before the old one stops |
| Heroku | Hard memory limits per app; logs as a stream |

**In scope:** Terraform for AWS and DNS; control-plane and worker compose stacks; Traefik with wildcard HTTPS; the worker agent (builds, runs, health checks, zero-downtime swaps, logs, metrics, databases, reconciliation, cleanup); container hardening and network rules; the platform's own deploy pipeline; backups, cost guardrails and uptime checks; the local development stack.

**Out of scope:** Kubernetes, more than one worker, autoscaling, GPUs, a container registry (images stay on the worker).

**Cut order if behind:** gVisor runtime → custom-domain certificates → automated backups → CPU kill switch (hard limits stay).

## Topology, Terraform and the control plane

| | Control plane VM | Worker VM |
| --- | --- | --- |
| Runs | Traefik, web, api, collab, agent, mcp, Postgres (platform), Redis | Traefik (apps), worker agent, BuildKit, shared Postgres for users, per-project Redis, every deployed app |
| Size | t3.medium (2 vCPU, 4 GB), 30 GB gp3 | t3.large (2 vCPU, 8 GB), 80 GB gp3; t3.xlarge (4 vCPU, 16 GB) in demo week for faster builds |
| Public address | Elastic IP for `app.{domain}` | Elastic IP for `*.apps.{domain}` |
| Private address | Fixed: host `.10` of the default subnet | Fixed: host `.11` of the default subnet |
| Inbound | 80 and 443 from anywhere; 4000 and 6379 from the worker's security group only; no SSH | 80 and 443 from anywhere; no SSH |
| Access | Instance profile with `AmazonSSMManagedInstanceCore` only: shells through SSM Session Manager, deploys through SSM Run Command | Same |
| OS | Ubuntu 24.04, Docker Engine with the Compose plugin, unattended upgrades | Same |

**Region:** `eu-west-1` (Ireland) by default; `af-south-1` (Cape Town) is closer to Accra but has to be enabled on the account first.

**Terraform** (`infra/terraform`)

- Providers `aws` and `cloudflare`. State in an S3 bucket with native lock files (`use_lockfile = true`); state is never committed.
- Resources: a security group per VM, with no rule for port 22; two `aws_instance`s with `metadata_options { http_tokens = "required", http_put_response_hop_limit = 1 }`, no key pair and an SSM-only instance profile each; two Elastic IPs; cloud-init user data that installs Docker, writes `/opt/lift/host.env` and installs a systemd unit that brings the current release up at boot; Cloudflare records `app` and `*.apps` (DNS only, not proxied); an `aws_budgets_budget` of $50 a month emailing at 80% and 100%, plus a budget action that stops both instances at $120, both counting spend before credits (`include_credit = false`); GitHub's OIDC provider and the deploy role `lift-github-deploy`.
- Variables: `domain`, `alert_emails`, `github_repository` and `github_oidc_sub_prefix`, plus `region`, `worker_instance_type` and the budget amounts with defaults. Outputs: both IPs, the URLs, the SSM session command for each VM, the deploy role ARN and the GitHub Actions variables the deploy workflow reads.
- The default VPC is fine; put both instances in the same subnet so they talk over private IPs.

**Access without SSH.** Neither VM accepts SSH: there is no key pair and port 22 is closed in both security groups. Each VM's instance profile allows the SSM agent (preinstalled on Ubuntu's AMIs) and nothing else.

- **Your shell:** `aws ssm start-session --profile lift --target {instance-id}` (Terraform prints the exact command). It needs the AWS CLI's Session Manager plugin and runs with your own IAM identity, so CloudTrail records who opened it.
- **Deploys:** the role `lift-github-deploy` trusts exactly one GitHub OIDC subject: jobs on this repo's `main` branch, `repo:{owner}@{owner-id}/{repo}@{repo-id}:ref:refs/heads/main`. The IDs come from the repo's immutable subject claims, so a renamed or recreated repo can't take over the role. It may call `ssm:SendCommand` with the `AWS-RunShellScript` document on these two instances and read the results; it has no other permissions, and GitHub holds no AWS keys. Anyone who can push to `main` can therefore deploy, so `main` must be protected (pull requests only, as `docs/contracts.md` says). A `production` environment restricted to `main` is the stricter alternative: set `github_deploy_context = "environment:production"` and add `environment: production` to the deploy job in the same change.

**VM layout.** `/opt/lift/host.env` holds the facts cloud-init writes (role, domain, private IPs); `/opt/lift/.env` (mode 600) holds the secrets, filled in by hand; each deploy unpacks `infra/compose`, `infra/traefik` and `infra/scripts` into `/opt/lift/releases/{sha}`, and `/opt/lift/current` points at the running one. `infra/scripts/lift-release.sh` runs Compose with all three env files, so every command on a VM uses the same settings.

**DNS and HTTPS.** The domain lives in Cloudflare for its free DNS API. A Cloudflare API token limited to editing DNS on that one zone lets Traefik on the worker get a wildcard certificate for `*.apps.{domain}` by DNS-01; the control plane gets `app.{domain}` the same way.

**Control-plane compose** (`infra/compose/control.yml`)

| Service | Image | Routing | Notes |
| --- | --- | --- | --- |
| `traefik` | Traefik v3 | Ports 80 and 443 | HTTP to HTTPS redirect, ACME by DNS-01, access logs |
| `web` | `ghcr.io/{org}/lift-web:{sha}` | `Host(app.{domain})`, priority 1 | |
| `api` | `ghcr.io/{org}/lift-api:{sha}` | `Host(app.{domain}) && PathPrefix(/api)`, priority 10 | A second listener serves `/internal` on `{private-ip}:4000` and is never routed by Traefik |
| `collab` | `ghcr.io/{org}/lift-collab:{sha}` | `Host(app.{domain}) && PathPrefix(/collab)`, priority 10 | WebSockets pass through Traefik |
| `mcp` | `ghcr.io/{org}/lift-mcp:{sha}` | `Host(app.{domain}) && PathPrefix(/mcp)`, priority 10 | HTTP transport (cut list) |
| `agent` | `ghcr.io/{org}/lift-agent:{sha}` | none | Internal network only |
| `postgres` | Postgres 17 | none | Volume `pgdata`; nightly `pg_dump` to S3 |
| `redis` | Redis 7 | none publicly | `appendonly yes`, `requirepass`; published on `{private-ip}:6379` for the worker |

**Platform deploys** (`deploy.yml`, with WS5): every merge to `main` builds the six images, pushes them to GitHub Container Registry tagged with the commit SHA, then assumes `lift-github-deploy` by OIDC and runs commands on each VM through SSM Run Command: unpack the release and `docker compose pull` on both, run migrations as a one-off `api migrate` container on the control plane, then `docker compose up -d` with `IMAGE_TAG` set on the control plane and then the worker. Secrets live only in `/opt/lift/.env` (mode 600) on each VM; the deploy itself needs no GitHub secrets, only repository variables (role ARN, region, instance IDs, domain).

**Local stack** (`infra/compose/dev.yml`): Postgres, Redis, BuildKit and a Traefik routing `*.apps.localhost` to containers on your machine, so the worker runs locally exactly as it does on the VM.

## Worker VM and the worker agent

**Worker compose** (`infra/compose/worker.yml`)

| Service | What it does |
| --- | --- |
| `traefik-apps` | Ports 80 and 443; Docker provider with `exposedByDefault=false`, watching network `lift-edge`; default certificate `*.apps.{domain}` |
| `buildkit` | `moby/buildkit`, privileged, listening on `tcp://buildkit:1234` on an internal network, with a cache volume |
| `worker` | The worker agent (`apps/worker`); mounts `/var/run/docker.sock`; on network `lift-system` with the fixed subnet `172.30.0.0/24`; `BUILDKIT_HOST=tcp://buildkit:1234` |
| `lift-pg` | Shared Postgres 17 for users' databases; joins a project's network when that project gets a database |

**The worker agent** is Node and TypeScript, with BullMQ workers and `dockerode` for the Docker API.

| Queue | Concurrency | Why |
| --- | --- | --- |
| `lift-build` | 1 on t3.large, 2 on t3.xlarge | Builds are CPU-bound |
| `lift-deploy` | 4 | |
| `lift-ops` | 4 | |

### Build job

1. Report `building`. Fetch `build-context`: a short-lived clone token, the root directory, the builder and build-time variables.
2. Clone exactly the commit into `/var/lib/lift/builds/{deploymentId}`: `git init`, then `git fetch --depth 1` from `https://x-access-token:{token}@github.com/{owner}/{repo}.git` at `{sha}`, then `git checkout FETCH_HEAD`. Never write the token to disk or a log.
3. Build the image `lift/{serviceId}:{deploymentId}`:
    - **Dockerfile** (builder `dockerfile`, or a `Dockerfile` in the root directory): build through BuildKit, with build-time variables as build args.
    - **Railpack** otherwise: `railpack build {dir} --name lift/{serviceId}:{deploymentId}`, with build-time variables as `--env KEY=VALUE`.
4. Stream every output line to `logs:dep:{deploymentId}` with `stream: build`, plus `system` lines for each step ("Cloning a1b2c3d", "Detected Next.js", "Image built in 2m 14s").
5. After 15 minutes, kill the build and report `failed` with `build_timeout`. Any non-zero exit reports `failed` with `build_failed`. Success reports `deploying` with `imageTag`. Always delete the build directory.

### Deploy job

1. Fetch `runtime-env`. Make sure two networks exist: `lift-edge` (shared with Traefik) and `lift-prj-{projectId}` (private to the project).
2. Create the container `lift-{serviceSlug}-{last 6 of deploymentId}` with:
    - its environment from `runtime-env`;
    - Traefik labels: `traefik.enable=true`; a router and service named `dep-{deploymentId}` whose rule matches every hostname in the job (`Host(a) || Host(b)`), entry point `websecure`, `tls=true`; `loadbalancer.server.port={port}`; `traefik.docker.network=lift-edge`; and the labels `lift.project`, `lift.service`, `lift.deployment`;
    - limits: `NanoCpus = cpu × 1e9`, `Memory = MemorySwap = memoryMb` MiB, `PidsLimit 256`, `no-new-privileges`, `NET_RAW` dropped, restart policy `unless-stopped`, json-file logs capped at 3 × 10 MB;
    - networks `lift-edge` and the project network, with the service slug as an alias, so other services in the project reach it at `http://{service-slug}:{port}`.
3. Start it and poll `http://{container-ip}:{port}{healthcheckPath}` every 2 s; any response below 500 counts as healthy. Give up after 120 s.
4. Healthy: report `active` with `containerId`; after 10 s of overlap, stop and remove the service's other containers (same `lift.service`, different `lift.deployment`). Both answer during the overlap, so no request fails.
5. Unhealthy or exited: copy its last 100 log lines into the deployment stream, remove it, leave the old container running, and report `failed` with `healthcheck_failed` or `crashed`.

### Everything else the worker does

- **Runtime logs:** follow every Lift container's logs (`dockerode` with `follow` and `timestamps`) into `logs:svc:{serviceId}` with `stream: runtime`; re-attach after restarts.
- **Metrics:** every 15 s, read stats for every Lift container and post them to `POST /internal/v1/metrics`.
- **Databases:** for `provision_db`, fetch `provision-context`. Postgres: as the `lift-pg` superuser, run `CREATE ROLE … LOGIN PASSWORD …`, `CREATE DATABASE … OWNER …` and `REVOKE CONNECT ON DATABASE … FROM PUBLIC`, connect `lift-pg` to the project network, and report `ready` with host `lift-pg`, port 5432. Redis: start `lift-redis-{dbId}` (`redis:7-alpine` with `--requirepass`, `--maxmemory 64mb`, `--maxmemory-policy allkeys-lru`) on the project network and report host `lift-redis-{dbId}`, port 6379. `deprovision_db` reverses either.
- **Reconciliation:** at start and every 60 s, compare `desired-state` with what is running. Start anything missing from its local image (or report `failed` with `image_missing` if the image was pruned), and remove Lift containers nobody wants after 5 minutes' grace.
- **Cleanup:** every 6 hours, keep the images of each service's last 3 deployments and delete older ones; prune the BuildKit cache above 20 GB; delete leftover build directories.
- **Restarts:** restarting the worker never stops running apps; BullMQ re-queues stalled jobs, and every job is idempotent by `deploymentId`.

## Security hardening, cost and operations

### Hardening checklist

- [ ] **Metadata endpoint blocked:** IMDSv2 required with hop limit 1 (Terraform), plus `iptables -I DOCKER-USER -d 169.254.169.254 -j DROP`, so no app can read the instance's credentials.
- [ ] **Control plane unreachable from apps:** in `DOCKER-USER`, allow `172.30.0.0/24` (the worker's network) to the control plane's private IP on ports 4000 and 6379, and drop every other Docker subnet to that IP.
- [ ] **No spam:** drop outbound TCP 25 from Docker subnets.
- [ ] **Limits on every app container:** CPU, memory, swap and process count; no privileged containers, host networking or host mounts; `no-new-privileges`; `NET_RAW` dropped.
- [ ] **Docker socket** mounted only into the worker container, which has no inbound ports.
- [ ] **No SSH:** port 22 closed in both security groups and no key pair; shells and deploys go through SSM with IAM identities; the deploy role can only run commands on the two Lift VMs. sshd stays installed with root and password logins off, as a break-glass path only.
- [ ] **Secrets:** `/opt/lift/.env` mode 600; the Cloudflare token limited to DNS on one zone; the Anthropic key only on the control plane.
- [ ] **Firewall rules** live in `infra/scripts/firewall.sh`, installed by cloud-init and re-applied by a systemd unit after Docker starts.
- [ ] **Abuse (cut list):** default 0.5 vCPU and 512 MB, maximum 1 vCPU and 1 GB; a default-size container above 90% CPU for 10 minutes is stopped and its project flagged.
- [ ] **Stretch:** run app containers under gVisor (`runsc`) for kernel isolation.

### Cost (approximate on-demand prices in eu-west-1)

| Item | Per month |
| --- | --- |
| t3.medium control plane | about $33 |
| t3.large worker (t3.xlarge runs at about $135 a month in demo week) | about $67 |
| 110 GB of gp3 storage | about $10 |
| Two public IPv4 addresses (AWS has charged for each since 2024) | about $7 |
| S3 backups and data transfer | under $2 |

Credits can pay the bill, but the budget counts spending before credits, so they never hide it. At these rates both VMs running all month cost about $119, just under the $120 stop. To spend less, `infra/scripts/stop.sh` stops both instances at night (Elastic IPs keep the addresses) and `start.sh` brings them back; reconciliation restores every app on boot.

### Operations

- **Backups:** nightly `pg_dump` of the platform database to S3, kept 7 days. Users' databases are not backed up, and the docs say so.
- **Uptime:** a free external monitor on `/api/v1/health` and on one demo app, alerting the team chat.
- **Disk:** a cron script warns at 80% disk use on the worker and runs the image cleanup early.
- **Runbook** (`infra/README.md`): bootstrap from nothing, rotate secrets, restore a backup, replace the worker, read logs on each VM.

## Requirements, acceptance tests and agent kickoff prompt

### By Nov 18 (contracts v1)

- [ ] **INF-00** Job payloads and internal routes reviewed with WS1 in `packages/shared`; domain registered and moved to Cloudflare; AWS account with a budget alarm

### By Nov 19 (hello world live)

- [ ] **INF-01** Terraform: both VMs, security groups, Elastic IPs, DNS, budget, SSM access and the GitHub deploy role
- [ ] **INF-02** Control-plane compose with Traefik, HTTPS for `app.{domain}`, path routing
- [ ] **INF-03** Worker compose: Traefik with wildcard HTTPS, BuildKit
- [ ] **INF-04** Worker agent build job: clone, Railpack, log streaming, status reports
- [ ] **INF-05** Worker agent deploy job: labels, limits, health check, `active`; a pushed repo serves at its URL
- [ ] **INF-06** Local dev stack with `*.apps.localhost`
- [ ] **INF-07** Platform deploy pipeline to both VMs (with WS5)

### By Nov 23 (everything works by hand)

- [ ] **INF-08** Zero-downtime swap and removal of old containers
- [ ] **INF-09** Runtime log shipping and the metrics loop
- [ ] **INF-10** Database provisioning and deprovisioning; project networks and service aliases
- [ ] **INF-11** Hardening checklist items 1 to 8
- [ ] **INF-12** Reconciliation loop
- [ ] **INF-13** Dockerfile builds

### By Nov 28 (AI and editor done)

- [ ] **INF-14** Cleanup jobs (images, BuildKit cache, build directories)
- [ ] **INF-15** Backups, uptime monitor, disk alerts, runbook
- [ ] **INF-16** Load check: 5 builds and 20 running apps at once on the demo-week instance
- [ ] **INF-17** (cut list) CPU kill switch
- [ ] **INF-18** (cut list) Custom-domain certificates by HTTP-01
- [ ] **INF-19** (cut list) gVisor runtime

### Acceptance tests

- `terraform apply` on an empty account creates everything; `terraform destroy` removes it.
- A `build` then `deploy` of the demo Next.js repo serves `https://{service}-{project}.apps.{domain}` with a valid certificate within 4 minutes on t3.xlarge.
- A test container on the worker cannot reach `169.254.169.254`, the control plane's ports 4000 and 6379, or any host on port 25.
- A container that allocates past its memory limit is killed while its neighbours keep serving.
- Redeploying while a script requests the app every 250 ms produces zero failed requests.
- Restarting the worker container leaves apps running; rebooting the VM brings every active app back within 3 minutes.

### Agent kickoff prompt

```text
You are working in the Lift monorepo. Before anything else, read AGENTS.md, docs/contracts.md
and docs/prd/04-infrastructure.md.

Scope: infra/ and apps/worker. Job payloads and internal routes are contracts in packages/shared;
change them only through an `interface` issue.

Task: implement requirement <INF-XX> only.
1. Restate it and list the files and commands involved.
2. For worker code, write tests first: unit tests for label and limit generation, and an
   integration test that builds and runs a tiny fixture app with real Docker.
3. For infrastructure, keep it reproducible: everything in Terraform, compose files or scripts in
   the repo; no manual console steps except creating credentials.

Rules: payloads never carry secrets; never log tokens or variable values; every app container
gets the limits, labels and hardening flags in the PRD; every job is idempotent by deploymentId.

Finish with `pnpm lint && pnpm typecheck && pnpm --filter worker test` (and `terraform validate`
for infrastructure), then summarise what changed and how you checked it on a real machine.
```
