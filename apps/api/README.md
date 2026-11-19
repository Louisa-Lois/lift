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

**Next:** BE-06 (deployments and the project events stream), BE-07 (deployment logs), BE-08 (push webhooks).

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
