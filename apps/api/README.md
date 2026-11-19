# @lift/api

The REST API every client and the worker go through. **Owner:** WS1 Back end & API. **Spec:** [docs/prd/01-backend-api.md](../../docs/prd/01-backend-api.md).

**Today:** the Fastify skeleton (BE-01).
- Every request and response schema is a Zod schema from `@lift/shared` (through `fastify-type-provider-zod`), which validates input, checks output and generates `GET /api/v1/openapi.json`.
- Every error is `application/problem+json` with a stable `code`; routes throw `problem(code, detail)` from `src/lib/problem.ts`.
- Pino logs redact credential headers and drop query strings.
- `GET /api/v1/health` answers ok only when Postgres and Redis answer within a second.
- **Sign-in (BE-03):** GitHub OAuth, invite-only through `ALLOWED_GITHUB_LOGINS`, 14-day sliding sessions, and `GET /me`.
- **Repos (BE-04):** `GET /github/repos` (search with `query`) and `GET /github/repos/:owner/:repo/branches`, read with the user's own GitHub token.
- **Projects and services (BE-05):**
  - CRUD, with slugs and a generated `{service}-{project}` subdomain, and a 4-character suffix on a clash.
  - A non-member gets 404, and a role that's too low gets 403.
  - Every change writes an `events` row and appends it to the project's Redis Stream.
  - Deleting queues `remove_service` for the worker.
- **Deployments (BE-06):**
  - `POST /services/:id/deployments` resolves the commit (the branch head by default), queues it as `manual`, cancels any older queued deployment of the service, and queues the build job. Creating a service with `deploy: true` does the same.
  - The state machine in `src/services/deployment-state.ts` is the PRD's table as data.
  - The worker's routes under `/internal/v1` (build context, runtime environment, status reports) need `Authorization: Bearer {WORKER_TOKEN}`. A request with `X-Forwarded-*` headers gets 404, so nothing routed by Traefik reaches them. A refused report gets 409 and a repeated one 200.
  - `deploying` queues the deploy job with the service's hostnames; `active` supersedes the previous active deployment.
  - A backstop (in `src/index.ts`, every minute) fails deployments with no update for 20 minutes while building or 5 while deploying.
  - `GET /projects/:id/events` and `/events/stream` (Server-Sent Events): each event with its Redis Stream ID, resume with `Last-Event-ID`, a heartbeat every 15 seconds, `Cache-Control: no-transform`.
  - Autofix jobs are queued once the agent service consumes them (Nov 24).

- **Deployment logs (BE-07):**
  - `GET /deployments/:id/logs?tail=` gives the last lines, oldest first, each with its stream entry ID.
  - `GET /deployments/:id/logs/stream` replays from the first line (or after `Last-Event-ID`), follows live, and ends with one `end` event carrying the final status.
  - When a deployment ends, the API appends an end marker to `logs:dep:{id}`, copies the lines to `build_logs` (NDJSON, the last 1 MB) and lets the stream expire after 7 days. After that, both routes read the copy.

- **Push deploys (BE-08):**
  - Creating a service adds a GitHub webhook for `push` events, with a random secret of the service's own, stored encrypted. A service made before then gets its webhook on its next manual deploy, and deleting a service removes it.
  - The webhook is best effort: none is added while `PUBLIC_URL` is localhost (GitHub can't deliver there), and a user without admin rights on the repo gets manual deploys only. It never fails the request that adds it.
  - `POST /webhooks/github?service=svc_…` checks `X-Hub-Signature-256` against the raw body in constant time (401 if wrong) and answers `ping` with 200.
  - A push to the service's branch deploys its head commit with `trigger: push`, once per commit: a redelivered push changes nothing.
  - Other branches, branch deletions, other repos and other events get a 202 with the reason, for GitHub's delivery log.

- **API tokens (BE-14, tokens part):**
  - `GET /tokens`, `POST /tokens` and `DELETE /tokens/:id`: personal tokens (`lift_pat_` and 32 characters) for the CLI, the MCP server and scripts. The plaintext is in the answer to `POST` only; the database keeps its SHA-256 and the first 12 characters. Revoking takes effect at the next request.
  - Any route takes `Authorization: Bearer lift_pat_…` instead of the cookie, and a token wins over a cookie. A token whose login leaves `ALLOWED_GITHUB_LOGINS` stops working but isn't revoked; signing out with a token revokes nothing.
  - Deny by default (`src/plugins/scopes.ts`): every `/api/v1` route needs a session or a token unless it is marked `config: { public: true }`. `test/auth-coverage.test.ts` walks every route to keep it that way.
  - Scopes are levels: `read` (GET), `deploy` (also deploy, roll back, cancel and restart) and `admin` (everything the user's role allows, including creating tokens). A route names its scope with `config: { scope }`; the default is `read` for GET and `admin` otherwise. The project role is checked as for a session.
  - A token deploys with `trigger: cli`, a session with `manual`. Tokens for one project (`projectId`) get 400 for now.
  - The CLI's browser login (`/auth/cli…`) and `POST /auth/session` come after Nov 26.

- **Variables (BE-09):**
  - `GET /services/:id/variables` lists every variable, sorted by key, each value masked as `••••` and its last 4 characters. `?reveal=true` shows the values to editors (and to admin tokens).
  - `PUT /services/:id/variables` sets keys and deletes those whose value is null, in one transaction. Values are encrypted with `ENCRYPTION_KEY`; PORT and `LIFT_*` keys come back as field errors. Every change emits `variables.changed` with the keys, never the values, and answers `requiresRedeploy: true`: changes wait for the next deployment.
  - A value set by a user over one a database wrote becomes the user's.
  - `build-context` hands the worker every stored variable for the build; `runtime-env` gives them to the container with the four system ones, sorted, and `envHash` over all of them. Both decrypt only for WORKER_TOKEN.

**Next:** the rest of the Nov 22 work: Postgres databases (BE-10) and rollback (BE-11).

| Command | What it does |
| --- | --- |
| `pnpm --filter @lift/api dev` | Start on port 4000 with the root `.env`, restarting on changes |
| `pnpm --filter @lift/api test` | Vitest with `app.inject()` against the Postgres and Redis from `pnpm stack:up` |
| `pnpm --filter @lift/api build` | Bundle to `dist/index.js`; `pnpm --filter @lift/api start` runs it |
| `node dist/index.js check-env` | Validate the environment and exit; the deploy runs it before every rollout |

**Environment** (`src/env.ts`): in development and tests the URLs fall back to the local stack and the secrets may be missing, so the API starts before `.env` is complete. Production refuses to start without every variable, and names the missing ones.

- **Database tests:** `createTestDatabase()` from `@lift/db/testing` gives each test file its own migrated database.

Layout to grow into, from the PRD:
- `src/plugins/`
- `src/routes/v1/`, one file per resource
- `src/routes/internal/`, the worker and agent routes
- `src/services/`, business logic with no HTTP
- `src/jobs/`
- `src/lib/`
