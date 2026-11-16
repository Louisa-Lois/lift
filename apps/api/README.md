# @lift/api

The REST API every client and the worker go through. **Owner:** WS1 Back end & API. **Spec:** [docs/prd/01-backend-api.md](../../docs/prd/01-backend-api.md).

**Today:** a Fastify server with Zod-validated environment, credential redaction in logs, `GET /api/v1/health` and tests.
**Next:** BE-01 (plugins, problem+json errors, OpenAPI), then BE-02 to BE-08 by Nov 19.

| Command | What it does |
| --- | --- |
| `pnpm --filter api dev` | Start on port 4000 with the root `.env`, restarting on changes |
| `pnpm --filter api test` | Vitest (`app.inject()`, no network) |
| `pnpm --filter api build` | Bundle to `dist/index.js`; `pnpm --filter api start` runs it |

Layout to grow into, from the PRD: `src/plugins/`, `src/routes/v1/` (one file per resource), `src/routes/internal/` (worker and agent routes on a second listener bound to the private IP), `src/services/` (business logic, no HTTP), `src/jobs/`, `src/lib/`.
