# PRD 1 · Back end & API

> Read together with `docs/contracts.md`. Owner: Team Member 1, paired with WS4. Paste the kickoff prompt at the bottom into your coding agent to start.

## Goal, scope and inspiration

**WS1 builds the API that every client and the worker go through: accounts, projects, services, deployments, variables, databases, domains, logs, live events and the live editor's back end.** By Nov 23 every demo step works by hand through it; by Nov 28 the AI agent and the editor drive it too.

- **Owner:** Team Member 1, paired with WS4. **Reviewers:** WS2 for anything the dashboard calls, WS4 for internal routes.
- **Owns:** `apps/api`, `apps/collab`, `packages/db`; co-owns `packages/shared` under the interface rule.
- **Used by:** WS2 (dashboard and editor), WS3 (agent tools, MCP), WS4 (worker), WS5 (CLI, tests).

| Incumbent | What we copy |
| --- | --- |
| Railway | Project → services → deployments; variables that are staged and applied on the next deploy; one public API powering its own dashboard and CLI; private hostnames between services in a project |
| Render | Resource types (web service, static site, Postgres, Key Value) and a clean REST shape like `/services/{id}/deploys`; an events feed per service |
| Vercel | Immutable deployments tied to a commit; instant rollback that re-points to an existing image instead of rebuilding |
| Heroku | Config changes produce a new release; attaching a database injects `DATABASE_URL` automatically |
| Stripe (API design) | Prefixed IDs, one error format with stable codes, cursor pagination, the spec as the source of truth |

**In scope:** GitHub sign-in and API tokens; projects and members; services from GitHub repos; deployments with a state machine, rollback, cancel and restart; push webhooks; encrypted variables; Postgres and Redis provisioning; generated domains; build and runtime logs; live events; metrics and usage; the collaboration server and editor commits; proxy routes for the AI agent; the internal API for the worker; OpenAPI.

**Out of scope:** billing and Stripe (traded for the editor); preview environments; multiple regions; a GitHub App installation flow (we use an OAuth app).

**Cut order if behind:** custom domains → incident events from the watcher → creating and renaming files in the editor.

## Code layout and data model

```text
apps/api/src/
├─ server.ts              # build the Fastify app, register plugins and routes
├─ env.ts                 # Zod-validated environment; the app refuses to start on bad config
├─ plugins/               # auth (cookie, bearer, worker, agent), db, redis, queues, errors,
│                         # rate-limit, openapi, sse
├─ routes/v1/             # one file per resource: auth, me, tokens, github, projects, members,
│                         # services, deployments, logs, variables, databases, domains, events,
│                         # metrics, usage, editor, agent, evals, webhooks, health
├─ routes/internal/       # worker and agent routes, on a second listener bound to the private IP
├─ services/              # business logic, no HTTP: deployments.ts (state machine), github.ts,
│                         # crypto.ts, slugs.ts, events.ts, variables.ts, databases.ts, usage.ts,
│                         # editor.ts, plans.ts
├─ jobs/                  # enqueue helpers typed by packages/shared/src/jobs.ts
└─ lib/                   # ids, errors, pagination, redaction
apps/api/test/            # Vitest route tests against real Postgres and Redis from the dev stack
apps/collab/src/server.ts # Hocuspocus server (see "Live editor back end")
packages/db/src/schema.ts # Drizzle tables below; SQL migrations in packages/db/migrations
packages/db/seed.ts       # demo user, project, service and deployments with logs
```

Rules for this codebase: route handlers stay thin (validate, call a service, return); request and response schemas come only from `packages/shared`; every state change inserts one `events` row and publishes it on Redis channel `project:{projectId}`; nothing logs a secret (pino `redact` covers tokens, cookies and variable values).

**Tables** (every table has `created_at`; soft-deleted ones have `deleted_at`):

| Table | Columns | Notes |
| --- | --- | --- |
| `users` | `id`, `github_id` (unique), `login`, `name`, `email`, `avatar_url`, `github_token_enc` | GitHub scopes `read:user user:email repo admin:repo_hook` |
| `sessions` | `id` (SHA-256 of the cookie value), `user_id`, `expires_at`, `ip`, `user_agent` | 14-day sliding expiry |
| `api_tokens` | `id`, `user_id`, `name`, `prefix`, `token_hash`, `scopes[]`, `project_id?`, `last_used_at`, `revoked_at` | Plaintext shown once; scopes `read`, `deploy`, `admin`; unique (`token_hash`) |
| `cli_logins` | `id`, `code`, `poll_secret_hash`, `user_id?`, `token_id?`, `status`, `expires_at` | Browser approval for `lift login`; status `pending` · `approved` · `denied` · `expired`; unique (`code`) |
| `projects` | `id`, `name`, `slug` (unique), `owner_id`, `deleted_at` | |
| `project_members` | `project_id`, `user_id`, `role` | Primary key on both IDs |
| `services` | `id`, `project_id`, `name`, `slug`, `type`, `repo_owner`, `repo_name`, `branch`, `root_dir`, `builder`, `dockerfile_path`, `build_command`, `start_command`, `port` (default 3000), `healthcheck_path` (default `/`), `cpu` (default 0.5), `memory_mb` (default 512), `subdomain` (unique), `autofix` (default true), `webhook_id`, `webhook_secret_enc`, `deleted_at` | Unique (`project_id`, `slug`) |
| `deployments` | `id`, `service_id`, `project_id`, `status`, `trigger`, `commit_sha`, `commit_message`, `commit_author`, `image_tag`, `container_id`, `rollback_of`, `error_code`, `error_message`, `created_by_user_id?`, `created_by_action_id?`, `queued_at`, `started_at`, `finished_at` | Index (`service_id`, `queued_at` desc); partial unique index on (`service_id`, `commit_sha`) where trigger is `push` or `editor`, for webhook de-duplication; partial unique index on (`service_id`) where status is `active` |
| `deployment_events` | `id`, `deployment_id`, `status`, `message`, `at` | The per-deployment timeline |
| `build_logs` | `deployment_id`, `content` | Copied from Redis when a deployment ends; max 1 MB |
| `variables` | `id`, `service_id`, `key`, `value_enc`, `source`, `database_id?`, `updated_at` | Unique (`service_id`, `key`); `database_id` says which database wrote the value |
| `databases` | `id`, `project_id`, `type`, `name`, `status`, `host`, `port`, `db_name`, `username`, `password_enc`, `env_var`, `deleted_at` | For Postgres, `db_name` and `username` are the database ID |
| `domains` | `id`, `service_id`, `hostname` (unique), `kind`, `status`, `verified_at` | The generated domain is created with its service |
| `events` | `id`, `project_id`, `actor_type`, `actor_id`, `type`, `data` (jsonb) | Index (`project_id`, `created_at` desc); the audit log |
| `metric_samples` | `service_id`, `ts`, `cpu_pct`, `mem_mb`, `net_rx_kb`, `net_tx_kb` | Index (`service_id`, `ts`); kept 7 days |
| `onboarding_plans` | `id`, `user_id`, `project_id?`, `repo_owner`, `repo_name`, `commit_sha`, `plan` (jsonb), `status` | `draft` · `applied` · `discarded` |
| `agent_sessions`, `agent_messages`, `agent_actions`, `diagnoses` | defined with WS3 (AI PRD); drafts in BE-00, settled in AI-00 | Tables live here so the API can serve them |
| `editor_documents` | `id`, `service_id`, `path`, `yjs_state` (bytea), `base_sha`, `updated_at` | Unique (`service_id`, `path`) |
| `editor_commits` | `id`, `service_id`, `commit_sha`, `message`, `paths[]`, `author_user_id`, `deployment_id` | |
| `eval_runs`, `eval_results` | defined with WS3 | |

**Encryption.** Every `*_enc` column uses AES-256-GCM with a 32-byte key from `ENCRYPTION_KEY` (base64), a random 12-byte IV per value, stored as `iv | tag | ciphertext`. `services/crypto.ts` is the only code that encrypts or decrypts.

## API surface

All public routes sit under `/api/v1`, need a session or bearer token unless marked public, and check the caller's role in the project. "Agent" means WS3 uses the route as a tool.

| Method and path | What it does | Role | Used by |
| --- | --- | --- | --- |
| `GET /auth/github/start?next=` | Redirect to GitHub with a `state` cookie; `next` is a same-site path to return to | public | web |
| `GET /auth/github/callback` | Exchange the code, upsert the user, set `lift_session`, redirect to `next` or `/` | public | web |
| `POST /auth/logout` | End the session | any | web |
| `POST /auth/cli` | Start a CLI login: returns `{ code, verifyUrl, pollSecret, expiresAt }` | public | cli |
| `GET /auth/cli/:code` | Poll with `Authorization: Bearer {pollSecret}`: `pending`, `denied`, `expired`, or `approved` with a new token | public | cli |
| `POST /auth/cli/:code/approve` · `/deny` | A signed-in user approves or denies the code | any | web |
| `POST /auth/session` | Exchange a personal token for a browser session (end-to-end tests, `lift open --dashboard`) | token | e2e, cli |
| `GET /me` | Current user | any | all |
| `GET /tokens` · `POST /tokens` · `DELETE /tokens/:id` | List, create (plaintext returned once), revoke | any | web, cli |
| `GET /github/repos?query=` | Repos the user can access: owner, name, private, defaultBranch, pushedAt | any | web, cli, agent |
| `GET /github/repos/:owner/:repo/branches` | Branch names | any | web |
| `GET /github/repos/:owner/:repo/tree?ref=` | File paths and sizes (max 5,000) | any | agent, editor |
| `GET /github/repos/:owner/:repo/contents?path=&ref=` | One text file (max 1 MB) | any | agent, editor |
| `GET /projects` · `POST /projects` | List, create | any | all |
| `GET /projects/:id` · `PATCH` · `DELETE` | Read (with services and databases), rename, delete | viewer, editor, owner | all |
| `GET /projects/:id/members` · `POST` · `PATCH /:userId` · `DELETE /:userId` | Members; invite by GitHub login | viewer, owner | web |
| `GET /projects/:id/services` · `POST` | List; create from `{ name, repo, branch, rootDir?, builder?, port?, deploy? }`, which also creates the webhook and generated domain | viewer, editor | web, cli, agent |
| `GET /services/:id` · `PATCH` · `DELETE` | Read; update settings (applied on next deploy); delete (stops containers, removes the webhook) | viewer, editor | all |
| `POST /services/:id/restart` | Restart the active container | editor | web, cli, agent |
| `GET /services/:id/deployments` · `POST` | List; trigger `{ commitSha? }` (defaults to the branch head), returns 202 | viewer, editor | all |
| `GET /deployments/:id` | One deployment with its timeline | viewer | all |
| `POST /deployments/:id/cancel` | Cancel while `queued` or `building` | editor | web, cli |
| `POST /deployments/:id/rollback` | New deployment reusing this one's image, no build | editor | web, cli, agent |
| `GET /deployments/:id/logs?tail=` · `GET /deployments/:id/logs/stream` | Build and deploy logs: snapshot, live | viewer | web, cli, agent |
| `GET /deployments/:id/diagnosis` | The AI's diagnosis of a failed deployment, stored by the agent | viewer | web, cli |
| `GET /services/:id/logs?since=&q=&limit=` · `GET /services/:id/logs/stream` | Runtime logs: search, live | viewer | web, cli, agent |
| `GET /services/:id/metrics?window=1h\|6h\|24h` | CPU, memory and network per minute | viewer | web, agent |
| `GET /projects/:id/usage?from=&to=` | vCPU-hours, GB-hours and estimated cost per service | viewer | web |
| `GET /services/:id/variables` | Variables with values masked, unless `?reveal=true` (editor) | viewer | web, cli, agent (keys only) |
| `PUT /services/:id/variables` | Bulk upsert `{ variables: { KEY: value or null } }`, where null deletes; returns `{ variables, requiresRedeploy: true }` | editor | web, cli, agent |
| `GET /projects/:id/databases` · `POST` | List; create `{ type, name? }`, returns 202 | viewer, editor | web, cli, agent |
| `GET /databases/:id` · `DELETE` · `GET /databases/:id/credentials` | Read, delete, reveal the connection string | viewer, editor, editor | web, cli |
| `GET /services/:id/domains` · `POST` · `DELETE /domains/:id` · `POST /domains/:id/verify` | Domains; custom ones are on the cut list | viewer, editor | web |
| `GET /projects/:id/events?cursor=` · `GET /projects/:id/events/stream` | Activity history, live | viewer | web |
| `GET /services/:id/editor/tree?ref=` | Files for the editor's tree | viewer | web |
| `POST /services/:id/editor/session` | `{ path }` → `{ documentName, token, baseSha, readOnly, user: { id, name, color, avatarUrl } }`; seeds the document from GitHub on first open | viewer | web |
| `GET /services/:id/editor/changes` | Files whose drafts differ from the last commit | viewer | web |
| `POST /services/:id/editor/commit` | `{ message, paths? }` → `{ commitSha, deploymentId }` | editor | web |
| `POST /services/:id/editor/discard` | `{ paths? }` resets drafts to the last commit | editor | web |
| `POST /agent/plans` | `{ owner, repo, branch? }` → OnboardingPlan (proxied to the agent; up to 60 s) | any | web, cli, mcp |
| `POST /agent/plans/:id/apply` | Create the project, services, databases and variables from a plan, then the first deploy | any | web, cli, mcp |
| `POST /projects/:id/agent/messages` | `{ sessionId?, text }` → SSE stream of the assistant's reply | viewer; writes need an editor's approval | web, cli |
| `POST /agent/actions/:id/approve` · `/reject` | Decide on a proposed write | editor | web |
| `GET /evals/runs` · `GET /evals/runs/:id` | Evaluation results | any | web |
| `POST /webhooks/github?service=svc_…` | GitHub push events, signature-checked | public | GitHub |
| `GET /health` | Postgres and Redis reachable | public | uptime check |
| `GET /openapi.json` | The generated spec | public | agent, mcp |

Worker-only internal routes are listed in `docs/contracts.md`. The agent service gets two more internal routes, both requiring `AGENT_SERVICE_TOKEN`: `POST /internal/v1/agent/diagnoses` (store a diagnosis) and `POST /internal/v1/evals/runs` (store an evaluation run).

## Core flows and the live editor back end

### Sign-in

1. `GET /auth/github/start` sets a random `state` cookie (10 minutes) and redirects to GitHub with scopes `read:user user:email repo admin:repo_hook`.
2. The callback checks `state`, exchanges the code, fetches the profile and primary email, upserts the user and stores the GitHub token encrypted.
3. It creates a session, sets `lift_session` (httpOnly, Secure, SameSite=Lax, 14 days, sliding) and redirects to the `next` path given to `/auth/github/start` (only same-site paths), or to `/`.

### Creating a service

1. Check the user can read the repo with their token; otherwise fail with `github_error`.
2. Insert the service with its generated `subdomain` and a `generated` domain row.
3. Create a GitHub webhook for `push` events pointing at `/api/v1/webhooks/github?service={serviceId}`, with a random per-service secret.
4. If `deploy: true`, resolve the branch head and create a deployment with `trigger: manual`.

### Deployments

When a push arrives: verify `X-Hub-Signature-256` with that service's secret (401 if wrong); answer `ping`; ignore other events and other branches; skip if a deployment already exists for that service and commit from a push or the editor; otherwise create a deployment with `trigger: push` and enqueue a `build` job.

`POST /services/:id/deployments` has no `trigger` field: the API sets it from the credential. A session is `manual`, a `lift_pat_` token is `cli`, and the agent's `lift_svc_` token is `agent`. Rollback, editor and push deployments set their own.

| From | To | Triggered by | Notes |
| --- | --- | --- | --- |
| (new) | `queued` | API | Any older `queued` deployment of the same service becomes `canceled`: newest wins |
| `queued` | `building` | worker status | The worker picked up the build job |
| `building` | `deploying` | worker status with `imageTag` | The API then enqueues the `deploy` job |
| `deploying` | `active` | worker status with `containerId` | The previous `active` becomes `superseded`; the worker removes its container |
| `queued`, `building`, `deploying` | `failed` | worker status with `errorCode` | Codes: `clone_failed`, `build_failed`, `build_timeout`, `image_missing`, `healthcheck_failed`, `crashed`. The API enqueues autofix when the service has it on |
| `queued`, `building` | `canceled` | user | The API enqueues a `stop` op so the worker stops a build that already started; a late worker report gets `409` |
| (new rollback) | `deploying` | API | Copies `image_tag` from the chosen deployment and enqueues `deploy` directly |

As a backstop, the API fails a deployment with `upstream_unavailable` after 20 minutes in `building` or 5 minutes in `deploying` without a status update.

### Variables

- Stored encrypted. Responses mask values as `••••` plus the last 4 characters unless `reveal=true` (editor role).
- System variables are injected at runtime, never stored: `PORT` (the service's port), `LIFT_SERVICE_ID`, `LIFT_DEPLOYMENT_ID`, `LIFT_PUBLIC_URL`. They appear only in `runtime-env`, never in the variables routes. Users cannot set `PORT` or keys starting with `LIFT_`, and neither can the agent: autofix fixes a wrong port with `PATCH /services/:id { port }`.
- Changes are staged: every write emits `variables.changed` and returns `requiresRedeploy: true`; the next deployment picks them up, as on Railway.

### Databases

1. `POST` inserts the database as `provisioning` with generated credentials (24-character random password, encrypted; for Postgres the database and role are named after the database ID) and enqueues `provision_db`.
2. The worker fetches the credentials from `provision-context`, creates the database and reports `ready` with host and port.
3. The API upserts the database's `env_var` (`DATABASE_URL` for Postgres or `REDIS_URL` for Redis, unless a plan chose another key) with `source: database` and `database_id` into every service in the project, unless a user-set variable with that key exists, and emits `variables.changed`.
4. `DELETE` sets the database to `deleting` with `deleted_at` (it disappears from lists), enqueues `deprovision_db`, and removes the variables with that `database_id`. The worker reports only a failure.

### Logs, events, metrics and usage

- Log snapshots read the Redis Stream with `XREVRANGE`; SSE uses `XREAD BLOCK` from the client's `Last-Event-ID`. When a deployment ends, its stream is copied into `build_logs`. Runtime search filters the last 20,000 lines without regard to case.
- Events: insert into `events`, then `XADD events:prj:{projectId} MAXLEN ~ 1000` with the event as JSON (a Redis Stream rather than pub/sub, so the project stream resumes with `Last-Event-ID` like the log streams); the SSE endpoint reads with `XREAD BLOCK` and sends the whole event, with a heartbeat every 15 s.
- Metrics arrive from the worker every 15 s; the metrics endpoint averages them per minute.
- Usage: for each sample while a container is active, add `cpu × 15 s` vCPU-seconds and `memoryMb / 1024 × 15 s` GB-seconds, summed to hours. Estimated cost uses illustrative constants in `services/usage.ts` ($0.02 per vCPU-hour, $0.01 per GB-hour), labelled as illustrative in the UI.

### Worker reconciliation

`GET /internal/v1/worker/desired-state` returns every `active` deployment with its image, service slug, port, limits, hostnames and a hash of its runtime environment (the same `envHash` that `runtime-env` returns), plus every `ready` database, so the worker doesn't remove `lift-redis-*` containers. The worker calls it at start and every 60 s and fixes any drift, so a rebooted worker restores every app.

### Live editor back end

- **Collab server** (`apps/collab`): a Hocuspocus `Server` on port 4200, served at `/collab` behind Traefik.
- **Document name:** `{serviceId}:{path}` with `path` URL-encoded. The shared Yjs type is `ydoc.getText("content")`; WS2 uses exactly this name.
- **Opening a file:** the dashboard calls `POST /services/:id/editor/session`. The API checks the role; if no `editor_documents` row exists, it fetches the file at the branch head, builds a Y.Doc with that text, stores its state with `base_sha`, and returns a collab token: an HS256 JWT signed with `COLLAB_SECRET` holding `{ sub: userId, svc: serviceId, path, role, exp: 10 minutes }`.
- **`onAuthenticate`:** verify the token and that it matches the document name; viewers get a read-only connection; return `{ user: { id, name, color, avatarUrl } }` for presence, with the color picked from a fixed palette by user ID.
- **Persistence:** the Hocuspocus Database extension: `fetch` reads `yjs_state`, `store` upserts it (debounce 2 s, at most 10 s).
- **Commit & deploy** (`POST /services/:id/editor/commit`):
    1. For each changed document, load its Yjs state and read the text.
    2. Read the branch head. If a file changed upstream since its `base_sha`, return `409 conflict` with each of those files as a key in `fields`; the user discards and reopens (merging is out of scope).
    3. Create blobs, a tree on top of the head's tree, and a commit with the user's message, then fast-forward the branch ref (GitHub Git Data API, with the user's token so the commit is theirs).
    4. Create a deployment with `trigger: editor` for that commit, so the webhook delivery that follows is skipped as a duplicate; update each document's `base_sha`; emit `editor.committed`.
- **Limits:** text files up to 512 KB; binary files are read-only in the tree; up to 50 open documents per service; no creating, renaming or deleting files (cut list).

### AI agent routes

The API owns authentication for everything. Agent routes check the user and project, then call the agent service at `AGENT_URL` with `AGENT_SERVICE_TOKEN` and the user's ID. When the agent acts, it calls the public API with its `lift_svc_` token and `X-Lift-Act-As`; the API applies that user's permissions and records the action ID on anything it creates. Writes that need approval are stored in `agent_actions` as `proposed` and emitted as `agent.action_proposed`.

## Requirements, acceptance tests and agent kickoff prompt

### By Nov 18 (contracts v1)

- [ ] **BE-00** `packages/shared` v1 (IDs, enums, schemas, errors, events, jobs, typed client, fixtures) and `packages/db` schema v1, reviewed by every owner and tagged `contracts-v1`

### By Nov 19 (hello world live)

- [ ] **BE-01** Fastify skeleton: env validation, problem+json errors, pino with redaction, `/health`, generated `/openapi.json`
- [ ] **BE-02** Migrations and seed for users, sessions, projects, members, services, deployments, deployment events, events
- [ ] **BE-03** GitHub sign-in, sessions, `/me`, logout
- [ ] **BE-04** GitHub repos and branches endpoints
- [ ] **BE-05** Projects and services CRUD with generated subdomain, domain row and webhook
- [ ] **BE-06** Deployments: create, state machine, internal status route, `build` and `deploy` enqueueing, project events stream
- [ ] **BE-07** Deployment logs: snapshot and SSE from Redis Streams
- [ ] **BE-08** Push webhook with signature check and de-duplication

### By Nov 23 (everything works by hand)

- [ ] **BE-09** Variables: encryption, masking, bulk upsert, system variables, `build-context` and `runtime-env`
- [ ] **BE-10** Databases: provision and deprovision flow, credentials, automatic `DATABASE_URL` and `REDIS_URL`
- [ ] **BE-11** Rollback, cancel, restart, newest-wins
- [ ] **BE-12** Runtime logs: snapshot, search, SSE
- [ ] **BE-13** Metrics ingest and query; usage
- [ ] **BE-14** API tokens, CLI login flow, token-to-session exchange
- [ ] **BE-15** Members, and role checks on every route
- [ ] **BE-16** Desired-state endpoint for the worker
- [ ] **BE-17** Collab server, editor tree and session endpoints, document seeding

### By Nov 28 (AI and editor done)

- [ ] **BE-18** Editor commit, discard and changes; `trigger: editor` deployments
- [ ] **BE-19** Agent proxy routes, service-token impersonation, approve and reject actions, diagnosis storage
- [ ] **BE-20** Plan apply: project, services, databases, variables and the first deploy from an OnboardingPlan
- [ ] **BE-21** Rate limits (100 requests a minute per user, 20 on agent routes, 60 per webhook), the role test sweep, OpenAPI covering every public route
- [ ] **BE-22** (cut list) Custom domains with DNS verification

### Acceptance tests

- A new GitHub user signs in and `/me` returns their profile; signing in again reuses the same user.
- Creating a service with `deploy: true` on the demo Next.js repo reaches `active` within 5 minutes with the real worker, and the project stream emits `queued`, `building`, `deploying`, `active` in order.
- A webhook with a bad signature returns 401 and creates nothing; the same valid push delivered twice creates exactly one deployment.
- After `PUT` variables the database holds no plaintext, `GET` shows masked values, and `runtime-env` returns plaintext only with `WORKER_TOKEN`.
- Rollback creates a deployment with the earlier `image_tag` and no `build` job.
- A viewer gets `403 forbidden` on every write route (one generated test per route in the OpenAPI spec).
- Two users opening the same file get the same `documentName`; a commit creates one GitHub commit and one `trigger: editor` deployment, and the webhook that follows is skipped.
- The OpenAPI document validates and lists every public route.

Tests run with Vitest against real Postgres and Redis from `infra/compose/dev.yml`; GitHub is mocked with recorded responses. WS5's end-to-end suite covers the real GitHub path.

### Agent kickoff prompt

```text
You are working in the Lift monorepo. Before anything else, read AGENTS.md, docs/contracts.md
and docs/prd/01-backend-api.md.

Scope: apps/api, apps/collab, packages/db. Change packages/shared only if the task says so and an
`interface` issue exists. Do not touch other folders.

Task: implement requirement <BE-XX> only.
1. Restate the requirement and list the files you will create or change.
2. Write the tests for its acceptance criteria first and show that they fail.
3. Implement until they pass. Keep route handlers thin; put logic in src/services.

Rules: request and response schemas come from packages/shared; every state change writes an
events row and publishes to Redis; errors are problem+json with a stable code; never log or
return secrets; no new dependencies without saying why.

Finish by running `pnpm lint && pnpm typecheck && pnpm --filter api test`, then summarise what
changed, how to try it, and any contract change other workstreams need to know about.
```
