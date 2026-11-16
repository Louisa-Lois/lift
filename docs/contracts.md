# Lift — Overview & contracts

Nov 16, 2026 · Vitalik

Five workstreams build Lift in one monorepo by Nov 28, then freeze until the Dec 2 deadline. This file fixes what everyone shares: the repo layout, the stack, the contracts between apps and the rules for changing them. Give your coding agent this file plus your own PRD from `docs/prd/`.

| # | Workstream | Owner | PRD file |
| --- | --- | --- | --- |
| 1 | Back end & API | Team Member 1 (paired with WS4) | `docs/prd/01-backend-api.md` |
| 2 | Front end | Team Member 2 | `docs/prd/02-frontend.md` |
| 3 | AI agent | Team Member 3 | `docs/prd/03-ai-agent.md` |
| 4 | Infrastructure & worker | Team Member 4 (paired with WS1) | `docs/prd/04-infrastructure.md` |
| 5 | CLI, quality & delivery | Team Member 5 | `docs/prd/05-quality-delivery.md` |

## How to use these PRDs with any coding agent

Each teammate can use a different coding agent; the agents stay aligned because they all read the same files in the repo, not because they share a tool.

1. **Put the PRDs in the repo.** This file lives at `docs/contracts.md`; each PRD lives at `docs/prd/0N-<name>.md`. The back-end pair commits them with the skeleton; from then on the repo copy is what agents read.
2. **One agent brief for every tool.** The repo root has `AGENTS.md`: what Lift is, the layout, the commands, the rules. Codex and Cursor read `AGENTS.md` directly; `CLAUDE.md` holds the single line `@AGENTS.md` for Claude Code; `GEMINI.md` does the same for Gemini CLI. Never fork the brief per tool.
3. **Start every session with your PRD's kickoff prompt** (the last section of each PRD). Give the agent one requirement ID at a time, such as `FE-07`, on a branch named after it.
4. **Stay in your folders.** Your agent edits only what your PRD owns. Shared contracts in `packages/shared` change only through the interface rule below.
5. **Don't wait on each other.** Until the real API is live, build against mocks and fixtures generated from `packages/shared`. Each PRD says what it can mock.

## At a glance

Lift runs on two machines. Developers and AI tools reach the control plane at `app.{domain}`; visitors reach deployed apps on the worker at `*.apps.{domain}`. The machines talk only through Redis jobs one way and internal API calls the other, both defined in the contracts below.

```text
Developers (browser, CLI, AI coding tools) ──HTTPS, WebSockets──▶ CONTROL PLANE VM  (app.{domain})
                                                                   Edge router (Traefik) · Web app (apps/web)
                                                                   API (apps/api) · Collab server (apps/collab)
                                                                   Agent service (apps/agent) · MCP server (apps/mcp)
                                                                   Postgres (platform data) · Redis (jobs, logs)

Visitors (people using deployed apps) ──HTTPS──▶ WORKER VM  (*.apps.{domain})
                                                  Apps router (wildcard HTTPS) · Worker agent (apps/worker)
                                                  Builder (Railpack + BuildKit) · Runtime (Docker + limits)
                                                  User apps (a container each) · User databases (Postgres, Redis)

CONTROL PLANE ──jobs (BullMQ on Redis)──────────────────▶ WORKER VM
WORKER VM     ──status, logs, metrics (internal API)────▶ CONTROL PLANE
CONTROL PLANE ──model calls─────────────────────────────▶ Anthropic API
CONTROL PLANE ◀──webhooks, commits──────────────────────▶ GitHub
WORKER VM     ◀──clone──────────────────────────────────── GitHub
```

## Monorepo layout and stack

One pnpm workspace, one lockfile, one `main` branch. The workstream next to each folder owns it, enforced with `CODEOWNERS`.

```text
lift/
├─ AGENTS.md                  # the one agent brief, read by every tool
├─ CLAUDE.md                  # single line: @AGENTS.md
├─ GEMINI.md                  # single line: @AGENTS.md (only if someone uses Gemini CLI)
├─ package.json               # workspace scripts: dev, build, lint, typecheck, test, check, env:init, stack:up, db:*, eval, demo:check
├─ pnpm-workspace.yaml        # apps/*, packages/*, evals, e2e, and the version catalog
├─ turbo.json                 # task graph and caching
├─ biome.json                 # lint + format for the whole repo
├─ tsconfig.base.json         # strict TypeScript settings
├─ .env.example               # every variable, with a comment each
├─ .github/
│  ├─ workflows/ci.yml        # WS5  lint, typecheck, test, build on every PR
│  ├─ workflows/e2e.yml       # WS5  demo script, nightly and on demand
│  ├─ workflows/deploy.yml    # WS4 + WS5  build images, deploy the platform
│  ├─ CODEOWNERS
│  └─ pull_request_template.md
├─ apps/
│  ├─ web/                    # WS2  Next.js dashboard and live editor UI
│  ├─ api/                    # WS1  Fastify REST API, auth, orchestration, SSE
│  ├─ collab/                 # WS1  Hocuspocus server for the live editor
│  ├─ agent/                  # WS3  AI service: planner, autofix, ops chat, watcher
│  ├─ mcp/                    # WS3  MCP server so coding agents can use Lift
│  ├─ worker/                 # WS4  runs on the worker VM: build, run, logs, metrics, databases
│  └─ cli/                    # WS5  the `lift` command-line tool
├─ packages/
│  ├─ shared/                 # ALL  Zod schemas, enums, IDs, errors, events, job payloads, typed client, fixtures
│  ├─ db/                     # WS1  Drizzle schema, migrations, seed
│  └─ config/                 # WS5  shared TypeScript presets
├─ infra/                     # WS4
│  ├─ terraform/              # AWS and DNS
│  ├─ compose/                # control.yml, worker.yml, dev.yml
│  ├─ traefik/                # static and dynamic config
│  └─ scripts/                # bootstrap, deploy, firewall, start/stop
├─ evals/                     # WS3  repos.json, golden plans, runner
├─ e2e/                       # WS5  Playwright demo script
└─ docs/
   ├─ contracts.md            # this file
   ├─ prd/                    # the five PRDs
   ├─ adr/                    # one short file per decision
   └─ demo.md                 # WS5  the demo script, step by step
```

| Layer | Choice | Notes |
| --- | --- | --- |
| Language and runtime | TypeScript (strict) on Node.js 24 LTS | One language everywhere, including the worker and CLI |
| Workspace | pnpm workspaces + Turborepo | `pnpm dev` starts everything; Turborepo caches builds and tests |
| Lint and format | Biome | One tool; runs in pre-commit and CI |
| Tests | Vitest (unit, integration), Playwright (end to end) | |
| Web | Next.js (App Router), React, Tailwind CSS, shadcn/ui, TanStack Query, Monaco Editor | Dashboard and editor in one app |
| API | Fastify, Zod, OpenAPI generated from the route schemas | The OpenAPI file doubles as the AI's tool list |
| Database | Postgres 17, Drizzle ORM, drizzle-kit migrations | |
| Queues, logs, events | Redis 7: BullMQ queues, Redis Streams for logs, pub/sub for live events | |
| Live editor | Yjs, Hocuspocus server with its Database extension, y-monaco | |
| AI | Anthropic TypeScript SDK; `claude-sonnet-5-5` for planning, fixes and chat; `claude-haiku-5-5` for classifying and summaries | |
| MCP | Official MCP TypeScript SDK, stdio and Streamable HTTP | |
| Builds | Railpack on BuildKit; Dockerfile when the repo has one | Railpack is the open-source successor to Nixpacks that Railway runs |
| Runtime and routing | Docker Engine, Traefik v3 with Let's Encrypt | |
| Cloud | AWS EC2 (two VMs), Terraform, Cloudflare DNS | |
| CI/CD | GitHub Actions; images in GitHub Container Registry | |

Exact versions are pinned in the lockfile when the skeleton lands on Nov 16. Upgrading a major version follows the interface rule.

## Shared contracts

Everything in this section exists as code in `packages/shared` and is frozen as **contracts v1 on Nov 18** (git tag `contracts-v1`). After that, changes are additive unless every affected owner agrees.

### Data model

| Entity | ID prefix | Key fields | Owned by |
| --- | --- | --- | --- |
| User | `usr_` | githubId, login, name, email, avatarUrl | WS1 |
| Project | `prj_` | name, slug, ownerId | WS1 |
| ProjectMember | composite | projectId, userId, role: `owner` · `editor` · `viewer` | WS1 |
| Service | `svc_` | projectId, name, slug, type: `web` · `static`, repo {owner, name, branch}, rootDir, builder: `railpack` · `dockerfile`, buildCommand, startCommand, port, healthcheckPath, cpu, memoryMb, subdomain | WS1 |
| Deployment | `dep_` | serviceId, status, trigger: `push` · `manual` · `rollback` · `agent` · `editor` · `cli`, commitSha, commitMessage, imageTag, containerId, errorCode, errorMessage, rollbackOf, timestamps | WS1 |
| Variable | `var_` | serviceId, key, value (encrypted at rest, masked in responses), source: `user` · `database` · `agent` · `system` | WS1 |
| Database | `db_` | projectId, type: `postgres` · `redis`, name, status: `provisioning` · `ready` · `failed` · `deleting` | WS1 + WS4 |
| Domain | `dom_` | serviceId, hostname, kind: `generated` · `custom`, status | WS1 + WS4 |
| Event | `evt_` | projectId, actorType: `user` · `agent` · `system` · `worker`, actorId, type, data, createdAt | WS1 |
| ApiToken | `tok_` | userId, name, prefix, scopes, projectId (optional), lastUsedAt | WS1 |
| OnboardingPlan | `pln_` | repo, summary, services[], databases[], variables[], warnings[], confidence | WS3 (schema), WS1 (storage) |
| AgentSession, AgentAction | `ags_`, `act_` | projectId, kind: `onboarding` · `autofix` · `chat` · `watcher`, tool, args, status, requiresApproval, result | WS3 |
| EditorDocument | `edoc_` | serviceId, path, baseSha, Yjs state | WS1 |
| MetricSample | none | serviceId, ts, cpuPct, memMb, netRxKb, netTxKb | WS4 sends, WS1 stores |
| EvalRun, EvalResult | `evr_`, `evx_` | per-run summary, per-repo outcome | WS3 |

**Deployment status** is one of `queued`, `building`, `deploying`, `active`, `failed`, `canceled`, `superseded`. Only one deployment per service is `active`. The full state machine is in the back-end PRD.

### IDs, names and formats

- IDs are `prefix_` + 24 lowercase alphanumeric characters (e.g. `svc_8f3k2m9q1x7v4b6n0p5r2t8w`), generated only by `packages/shared/src/ids.ts`.
- JSON is camelCase, database columns snake_case, enum values lowercase.
- Timestamps are ISO 8601 UTC strings in JSON (`2026-11-16T14:05:00Z`).
- Slugs match `^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$`; variable keys match `^[A-Z_][A-Z0-9_]*$`.
- Every service gets a generated hostname `{service-slug}-{project-slug}.apps.{domain}`; on a clash a 4-character suffix is added.

### API rules

- Base path `/api/v1`, JSON only, described at `/api/v1/openapi.json`, generated from the route schemas.
- Auth: browser session cookie `lift_session`, or `Authorization: Bearer lift_pat_…` for the CLI, MCP and scripts. The agent service uses `lift_svc_…` plus an `X-Lift-Act-As: usr_…` header, accepted only with that token.
- Errors are `application/problem+json`: `{ type, title, status, detail, code, fields? }`. `code` is stable: `unauthenticated`, `forbidden`, `not_found`, `validation_failed`, `conflict`, `rate_limited`, `github_error`, `upstream_unavailable`, `internal`.
- Lists use cursors: `?limit=50&cursor=…` returns `{ data: [...], nextCursor: "…" or null }`.
- Writes return the full resource. Long-running actions (deploy, provision a database) return `202 Accepted` with the resource in its first status (`queued`, `provisioning`).
- Roles: `viewer` reads; `editor` reads and writes; `owner` also manages members and deletes the project.

### Real-time events (Server-Sent Events)

| Stream | Path | Event types | Payload |
| --- | --- | --- | --- |
| Project activity | `GET /api/v1/projects/:projectId/events/stream` | `deployment.created`, `deployment.status_changed`, `service.updated`, `database.status_changed`, `variables.changed`, `agent.action_proposed`, `agent.action_completed`, `editor.committed` | The changed resource, plus `previousStatus` on status changes |
| Deployment logs | `GET /api/v1/deployments/:deploymentId/logs/stream` | `log`, `end` | `{ ts, stream: build · deploy · runtime · system, line }` |
| Service logs | `GET /api/v1/services/:serviceId/logs/stream` | `log` | Same shape, runtime only |

Every event carries an `id` (its Redis Stream entry ID) so clients resume with `Last-Event-ID`; servers send a heartbeat comment every 15 seconds. Schemas live in `packages/shared/src/events.ts`.

### Worker jobs (control plane to worker)

Three BullMQ queues on the control plane's Redis. Payloads never contain secrets: the worker fetches them over the internal API when it needs them.

| Queue | Job | Payload (Zod schema in `packages/shared/src/jobs.ts`) |
| --- | --- | --- |
| `lift-build` | `build` | `deploymentId, serviceId, projectId, repo {owner, name, branch}, commitSha, rootDir, builder, dockerfilePath?` |
| `lift-deploy` | `deploy` | `deploymentId, serviceId, projectId, imageTag, port, healthcheckPath, cpu, memoryMb, hostnames[]` |
| `lift-ops` | `stop` · `restart` · `remove_service` · `provision_db` · `deprovision_db` | A union keyed on `op`, each with the IDs it acts on |

| Worker to control plane (internal API) | Purpose |
| --- | --- |
| `GET /internal/v1/deployments/:id/build-context` | Short-lived GitHub clone token, build settings, build-time variables |
| `GET /internal/v1/deployments/:id/runtime-env` | Decrypted runtime variables plus system variables |
| `POST /internal/v1/deployments/:id/status` | `{ status, message?, imageTag?, containerId?, errorCode?, at }` |
| `GET /internal/v1/databases/:id/provision-context` | Generated credentials for a new database |
| `POST /internal/v1/databases/:id/status` | `{ status, host?, port?, message? }` |
| `POST /internal/v1/metrics` | `{ samples: MetricSample[] }`, every 15 seconds |
| `GET /internal/v1/worker/desired-state` | Every deployment that should be running, for reconciliation |

Internal routes listen only on the control plane's private IP, never behind the public router, and require `Authorization: Bearer {WORKER_TOKEN}`.

**Logs** go straight from the worker into Redis Streams: `logs:dep:{deploymentId}` for build and deploy output (capped near 5,000 lines) and `logs:svc:{serviceId}` for runtime output (near 20,000 lines). Each entry has the fields `ts`, `stream` and `line`.

## Environment, ports, local development and working rules

| App | Dev port | Production address | Key variables |
| --- | --- | --- | --- |
| web | 3000 | `https://app.{domain}/` | `NEXT_PUBLIC_COLLAB_URL` |
| api | 4000 | `https://app.{domain}/api` (public); `http://{control-private-ip}:4000/internal` (worker only) | `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `PUBLIC_URL`, `APPS_DOMAIN`, `WORKER_TOKEN`, `AGENT_SERVICE_TOKEN`, `AGENT_URL`, `COLLAB_SECRET` |
| collab | 4200 | `wss://app.{domain}/collab` | `DATABASE_URL`, `COLLAB_SECRET` |
| agent | 4100 | internal only | `API_URL`, `AGENT_SERVICE_TOKEN`, `ANTHROPIC_API_KEY`, `REDIS_URL` |
| mcp | 4300 | `https://app.{domain}/mcp`, or local over stdio | `LIFT_API_URL`, `LIFT_TOKEN` |
| worker | none | worker VM | `CONTROL_API_URL`, `WORKER_TOKEN`, `REDIS_URL`, `APPS_DOMAIN`, `BUILDKIT_HOST` |
| cli | none | developers' machines | `LIFT_API_URL`; token saved in `~/.lift/config.json` |

Every server also reads `HOST` (default `127.0.0.1`, or `0.0.0.0` when `NODE_ENV=production`) and its own port variable: `API_PORT`, `AGENT_PORT`, `COLLAB_PORT` or `MCP_PORT`. `.env.example` lists every variable with a comment.

**Local development.** `pnpm env:init` creates the one `.env` at the repo root, with fresh development secrets, from `.env.example`; every app reads it in development. `pnpm stack:up` (`docker compose -f infra/compose/dev.yml up -d`) starts Postgres, Redis, BuildKit and a Traefik that serves deployed apps at `http://{service}.apps.localhost`; browsers resolve every `*.localhost` name to your own machine, so there is no DNS to set up. (The starter repo has Postgres and Redis; INF-06 adds BuildKit and Traefik.) `pnpm dev` then runs web, api, collab, agent and worker, with the worker using your local Docker. In development Next.js rewrites `/api/*` to port 4000, so the browser sees one origin and the session cookie just works; the editor connects straight to the collab server at `NEXT_PUBLIC_COLLAB_URL` (`ws://localhost:4200`), which checks its own token rather than a cookie. In production Traefik routes both paths on `app.{domain}`. `pnpm db:migrate && pnpm db:seed` creates a demo user and project. Each developer registers their own GitHub OAuth app with the callback `http://localhost:3000/api/v1/auth/github/callback`.

**Branches and reviews**

- `main` is protected: pull requests only, one approving review from someone other than the author, CI green, squash merge.
- Branch names follow `ws{N}/{REQ-ID}-short-name`, e.g. `ws2/FE-07-log-viewer`. Commit messages follow Conventional Commits (`feat(api): add rollback endpoint`).
- A PR written mostly by an agent says so in its description, and the reviewer reads it as carefully as human code.

**The interface rule.** Changes to `packages/shared`, `packages/db` migrations or `infra/` need an issue labelled `interface` and approval from the owner of every workstream that uses what changes. After Nov 18, only additive changes (new optional fields, new endpoints) go in without everyone's approval.

**Definition of done** for any requirement: merged to `main` with tests; working on staging (or the local stack before staging exists); new commands or variables documented in the app's README and `.env.example`; anything shown in the demo has its line in `docs/demo.md`.

**Secrets** never go in git, prompts or logs. `.env` files are git-ignored, and CI scans every push for leaked keys.

## Integration checkpoints

At each milestone the whole team runs the demo path together on staging; each workstream's cell must work by that date. The dated timeline itself is in the proposal.

| Checkpoint | WS1 Back end & API | WS2 Front end | WS3 AI agent | WS4 Infrastructure | WS5 CLI, quality & delivery |
| --- | --- | --- | --- | --- | --- |
| **Nov 18**, contracts v1 | `packages/shared` and DB schema v1 merged and tagged | Contracts reviewed; mocks running from fixtures | Plan, action and diagnosis schemas in `packages/shared` | Job and internal-API contracts reviewed | Repo tooling, CI and branch protection live |
| **Nov 19**, hello world live | Sign-in, projects, services, deployments, push webhook, project and log streams | Sign-in, project list, new service form, deployment list, live log viewer | Agent service calling Claude; read tools working against the API | Both VMs up; wildcard HTTPS; worker builds a repo and serves it at its URL | CI green; platform deploy pipeline; CLI `login`, `whoami`, `status` |
| **Nov 23**, everything works by hand | Variables, databases, rollback, runtime logs, metrics, usage, tokens, members, collab server | Project canvas, service panel, variables, databases, rollback, settings, usage, tokens | Planner valid on 10 repos; failure classifier; eval runner with all 30 cases | Zero-downtime swaps, runtime logs, metrics, databases, limits, firewall rules, reconciliation | CLI `up`, `logs`, `env`, `db`, `rollback`; end-to-end test of the manual path; security checklist v1 |
| **Nov 28**, AI and editor done | Editor commits, agent routes and approvals, plan apply, rate limits | Live editor with presence and commit, plan review, agent chat, diagnosis card, evals page | Autofix loop, ops chat, MCP server, full 30-case eval run | Cleanup jobs, backups, uptime checks, load check | Full demo in CI; CLI browser login and `lift ask`; report and slides drafted |
| **Nov 29 to Dec 1**, freeze | Fixes only | Polish and fixes | Eval reruns, prompt fixes | Stability, cost watch | Daily demo runs; video recorded; report finished |
| **Dec 2**, deadline | | | | | Submission |
