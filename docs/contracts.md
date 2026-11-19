# Lift — Overview & contracts

Nov 16, 2026, updated Nov 18 · Vitalik

Hakim builds the demo path end to end until it works (target Nov 26), and the rest of the team works in parallel from the briefs in `docs/briefs/`; `docs/start-here.md` has who does what and the dates. This file fixes what every app shares: the repo layout, the stack, the contracts between apps and the rules for changing them. Give your coding agent this file plus your brief (Hakim: the PRD you're building from).

| # | Workstream | Built by | PRD file |
| --- | --- | --- | --- |
| 1 | Back end & API | Hakim | `docs/prd/01-backend-api.md` |
| 2 | Front end | Hakim; Louisa owns the brand, theme and landing page | `docs/prd/02-frontend.md` |
| 3 | AI agent | Hakim; Lyse owns the test set, prompts and evaluation | `docs/prd/03-ai-agent.md` |
| 4 | Infrastructure & worker | Hakim | `docs/prd/04-infrastructure.md` |
| 5 | CLI, quality & delivery | David (the CLI); Esbert (everything else) | `docs/prd/05-quality-delivery.md` |

Louisa, David, Lyse and Esbert work from their briefs in `docs/briefs/`, which say which parts of these PRDs are theirs.

## How to use these PRDs with any coding agent

Each teammate can use a different coding agent; the agents stay aligned because they all read the same files in the repo, not because they share a tool.

1. **Put the PRDs in the repo.** This file lives at `docs/contracts.md`; each PRD lives at `docs/prd/0N-<name>.md`. They ship with the starter repo; from then on the repo copy is what agents read.
2. **One agent brief for every tool.** The repo root has `AGENTS.md`: what Lift is, the layout, the commands, the rules. Codex and Cursor read `AGENTS.md` directly; `CLAUDE.md` holds the single line `@AGENTS.md` for Claude Code; `GEMINI.md` does the same for Gemini CLI. Never fork the brief per tool.
3. **Start every session with your kickoff prompt:** the one in your brief, or for Hakim the one at the end of each PRD. Give the agent one task ID at a time, such as `UI-02`, on a branch named after it.
4. **Stay in your folders.** Your agent edits only the paths `AGENTS.md` gives you. Shared contracts in `packages/shared` are Hakim's until the handoff on Nov 26, then follow the interface rule below.
5. **Don't wait on each other.** Until the real API is live, build against the sample data in `@lift/shared/fixtures`. Each brief says what to build against.

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
   ├─ prd/                    # the five PRDs: the full system spec
   ├─ briefs/                 # what Louisa, David, Lyse and Esbert build, with dates and kickoff prompts
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

Everything in this section exists as code in `packages/shared`, landed by BE-00 on Nov 18 (git tag `contracts-v1`). Until the handoff on Nov 26 Hakim changes it freely, except that the parts of the typed client and fixtures David's CLI uses only grow. From the handoff on, changes are additive unless everyone affected agrees.

### Data model

| Entity | ID prefix | Key fields | Owned by |
| --- | --- | --- | --- |
| User | `usr_` | githubId, login, name, email, avatarUrl | WS1 |
| Project | `prj_` | name, slug, ownerId | WS1 |
| ProjectMember | composite | projectId, userId, role: `owner` · `editor` · `viewer` | WS1 |
| Service | `svc_` | projectId, name, slug, type: `web` · `static`, repo {owner, name, branch}, rootDir, builder: `railpack` · `dockerfile`, buildCommand, startCommand, port, healthcheckPath, cpu, memoryMb, subdomain | WS1 |
| Deployment | `dep_` | serviceId, status, trigger: `push` · `manual` · `rollback` · `agent` · `editor` · `cli`, commitSha, commitMessage, imageTag, containerId, errorCode, errorMessage, rollbackOf, timestamps | WS1 |
| Variable | `var_` | serviceId, key, value (encrypted at rest, masked in responses), source: `user` · `database` · `agent` · `system`, databaseId (when the value came from a database) | WS1 |
| Database | `db_` | projectId, type: `postgres` · `redis`, name, status: `provisioning` · `ready` · `failed` · `deleting`, envVar (default `DATABASE_URL` or `REDIS_URL`) | WS1 + WS4 |
| Domain | `dom_` | serviceId, hostname, kind: `generated` · `custom`, status: `pending` · `active` · `failed` | WS1 + WS4 |
| Event | `evt_` | projectId, actorType: `user` · `agent` · `system` · `worker`, actorId, type, data, createdAt | WS1 |
| ApiToken | `tok_` | userId, name, prefix, scopes, projectId (optional), lastUsedAt | WS1 |
| OnboardingPlan | `pln_` | repo, summary, services[], databases[], variables[], warnings[], confidence | WS3 (schema), WS1 (storage) |
| AgentSession, AgentAction | `ags_`, `act_` | projectId, kind: `onboarding` · `autofix` · `chat` · `watcher`, tool, args, status, requiresApproval, result | WS3 |
| EditorDocument | `edoc_` | serviceId, path, baseSha, Yjs state | WS1 |
| MetricSample | none | serviceId, ts, cpuPct, memMb, netRxKb, netTxKb | WS4 sends, WS1 stores |
| EvalRun, EvalResult | `evr_`, `evx_` | per-run summary, per-repo outcome | WS3 |

**Deployment status** is one of `queued`, `building`, `deploying`, `active`, `failed`, `canceled`, `superseded`. Only one deployment per service is `active`. The full state machine is in the back-end PRD.

Tables the data model above gives no prefix use `cli_` (CLI logins), `dpe_` (deployment timeline entries), `ecm_` (editor commits), `msg_` (agent messages) and `dgn_` (diagnoses). `system` variables (`PORT`, `LIFT_*`) are never stored: they appear only in the worker's runtime environment, never in the variables routes.

### IDs, names and formats

- IDs are `prefix_` + 24 lowercase alphanumeric characters (e.g. `svc_8f3k2m9q1x7v4b6n0p5r2t8w`), generated only by `packages/shared/src/ids.ts`.
- JSON is camelCase, database columns snake_case, enum values lowercase.
- Timestamps are ISO 8601 UTC strings in JSON (`2026-11-16T14:05:00Z`).
- Slugs match `^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$`; variable keys match `^[A-Z_][A-Z0-9_]*$`.
- Every service gets a generated hostname `{service-slug}-{project-slug}.apps.{domain}`; on a clash a 4-character suffix is added.

### API rules

- Base path `/api/v1`, JSON only, described at `/api/v1/openapi.json`, generated from the route schemas.
- Auth: browser session cookie `lift_session`, or `Authorization: Bearer lift_pat_…` for the CLI, MCP and scripts. The agent service uses `lift_svc_…` plus an `X-Lift-Act-As: usr_…` header, accepted only with that token.
- Errors are `application/problem+json`: `{ type, title, status, detail, code, fields? }`. `code` is stable: `unauthenticated` (401), `forbidden` (403), `not_found` (404), `validation_failed` (400), `conflict` (409), `rate_limited` (429), `github_error` (502), `upstream_unavailable` (503), `internal` (500). `fields` maps a field's dot path (`repo.owner`) to its message.
- Lists use cursors: `?limit=50&cursor=…` (at most 100) returns `{ data: [...], nextCursor: "…" or null }`. Small lists (variables, members, databases, domains, branches) return everything with `nextCursor: null`.
- Writes return the full resource. Long-running actions (deploy, provision a database) return `202 Accepted` with the resource in its first status (`queued`, `provisioning`). Deletes return `204`, except a database, which returns `202` with status `deleting`.
- Roles: `viewer` reads; `editor` reads and writes; `owner` also manages members and deletes the project.

### Real-time events (Server-Sent Events)

| Stream | Path | Event types | Payload |
| --- | --- | --- | --- |
| Project activity | `GET /api/v1/projects/:projectId/events/stream` | `deployment.created`, `deployment.status_changed`, `service.created`, `service.updated`, `service.deleted`, `service.restarted`, `database.status_changed`, `variables.changed` (keys only), `project.updated`, `project.deleted`, `member.changed`, `agent.action_proposed`, `agent.action_completed`, `editor.committed` | The full event `{ id, projectId, actorType, actorId, type, data, createdAt }`, as `GET /projects/:id/events` lists it; `data` is the changed resource, plus `previousStatus` on status changes |
| Deployment logs | `GET /api/v1/deployments/:deploymentId/logs/stream` | `log`, `end` | `log`: `{ ts, stream: build · deploy · runtime · system, line }`; `end`: `{ status }` |
| Service logs | `GET /api/v1/services/:serviceId/logs/stream` | `log` | Same shape, runtime only |

Every event carries an `id` (its Redis Stream entry ID) so clients resume with `Last-Event-ID`; project events go through a Redis Stream too (`events:prj:{projectId}`), not pub/sub, so all three resume the same way. Servers send a heartbeat comment every 15 seconds. Clients ignore event types they don't know, so a new type is an additive change. Log snapshots (`GET …/logs`) return `{ data: [{ id, ts, stream, line }] }`, so a client can open the stream from the last snapshot line. Schemas live in `packages/shared/src/events.ts` and `packages/shared/src/schemas/event.ts`.

### Worker jobs (control plane to worker)

Three BullMQ queues on the control plane's Redis, plus `lift-agent`, where the API puts an `autofix` job (`{ deploymentId }`) for the agent service. Payloads never contain secrets: the worker fetches them over the internal API when it needs them. The schemas are strict, so an unknown field fails.

| Queue | Job | Payload (Zod schema in `packages/shared/src/jobs.ts`) |
| --- | --- | --- |
| `lift-build` | `build` | `deploymentId, serviceId, projectId, repo {owner, name, branch}, commitSha, rootDir, builder, dockerfilePath?` |
| `lift-deploy` | `deploy` | `deploymentId, serviceId, serviceSlug, projectId, imageTag, port, healthcheckPath, cpu, memoryMb, hostnames[]` |
| `lift-ops` | `stop` · `restart` · `remove_service` · `provision_db` · `deprovision_db` | A union keyed on `op`, each with only the IDs it acts on: `stop` and `restart` take `deploymentId, serviceId, projectId` (`stop` also cancels a running build); `remove_service` takes `serviceId, projectId`; the database ops take `databaseId, projectId, type`. A Postgres database and its role are named after the database ID |

| Worker to control plane (internal API) | Purpose |
| --- | --- |
| `GET /internal/v1/deployments/:id/build-context` | GitHub clone token (the project owner's OAuth token, not short-lived), build settings, build-time variables |
| `GET /internal/v1/deployments/:id/runtime-env` | `{ variables: [{ key, value, source }], envHash }`: decrypted runtime variables plus system variables |
| `POST /internal/v1/deployments/:id/status` | `{ status, message?, imageTag?, containerId?, errorCode?, at }`: `deploying` needs `imageTag`, `active` needs `containerId`, `failed` needs `errorCode`. Repeats are accepted; a report the state machine refuses (a canceled deployment) gets `409`, and the worker stops |
| `GET /internal/v1/databases/:id/provision-context` | Generated credentials for a new database |
| `POST /internal/v1/databases/:id/status` | `{ status: ready · failed, host?, port?, message? }`; after `deprovision_db` the worker reports only a failure |
| `POST /internal/v1/metrics` | `{ samples: MetricSample[] }`, every 15 seconds; `cpuPct` is a percentage of the service's CPU limit, `netRxKb` and `netTxKb` are KB per interval |
| `GET /internal/v1/worker/desired-state` | Every deployment that should be running (with `serviceSlug` and `envHash`) and every ready database, for reconciliation |

Internal routes listen only on the control plane's private IP, never behind the public router, and require `Authorization: Bearer {WORKER_TOKEN}` (the agent's two internal routes require `AGENT_SERVICE_TOKEN` instead).

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

- `main` is protected: pull requests only, squash merges only, and CI must pass once `ci.yml` runs. Nobody can bypass this, the repo owner included. GitHub requires no approvals: by agreement, teammates' pull requests wait for Hakim's approval, and until the handoff Hakim merges his own once CI is green.
- Branch names follow `{person}/{ID}-short-name`, e.g. `louisa/UI-02-landing-page` or `hakim/BE-06-deployments`. Commit messages follow Conventional Commits (`feat(api): add rollback endpoint`).
- A PR written mostly by an agent says so in its description, and the reviewer reads it as carefully as human code.

**The interface rule** (from the handoff on Nov 26). Changes to `packages/shared`, `packages/db` migrations or `infra/` need an issue labelled `interface` and approval from everyone whose work uses what changes; only additive changes (new optional fields, new endpoints) go in without it. Until the handoff Hakim owns all three and changes them directly.

**Definition of done** for any requirement: merged to `main` with tests; working on staging (or the local stack before staging exists); new commands or variables documented in the app's README and `.env.example`; anything shown in the demo has its line in `docs/demo.md`.

**Secrets** never go in git, prompts or logs. `.env` files are git-ignored, and CI scans every push for leaked keys.

## Checkpoints

The dated plan, with what Hakim and each teammate deliver by when, is in `docs/start-here.md`. The demo path is complete at the handoff on Nov 26; from then on the whole team runs the demo together every day, and Nov 29 to Dec 1 is a freeze, fixes only, before the Dec 2 deadline.
