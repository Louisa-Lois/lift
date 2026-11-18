# @lift/db

The platform database: Drizzle schema, SQL migrations and seed. **Owner:** WS1 Back end & API. **Spec:** "Tables" in [docs/prd/01-backend-api.md](../../docs/prd/01-backend-api.md).

**Today:** the v1 schema (BE-00) in `src/schema.ts` and its first migration, `migrations/0000_contracts_v1.sql`. The Postgres enums are built from the value arrays in `@lift/shared`, so the two can't drift. The agent, diagnosis and eval tables are drafts for AI-00 (mostly `text` and `jsonb`).
**Next:** the seed in BE-02.

| Command (from the repo root) | What it does |
| --- | --- |
| `pnpm db:generate` | Write a SQL migration into `packages/db/migrations` from changes in `src/schema.ts` |
| `pnpm db:migrate` | Apply migrations to `DATABASE_URL` |
| `pnpm db:seed` | Load the demo user, project, service and deployments |
| `pnpm --filter @lift/db test` | Apply every migration to a throwaway database on the `pnpm stack:up` Postgres, check the tables and indexes, then drop it. Fails if Postgres isn't running |

Define columns in camelCase; `casing: "snake_case"` makes `githubId` the SQL column `github_id`. Migrations change only through the interface rule.

Indexes worth knowing about when writing queries:

- `deployments_push_editor_dedup`: unique (`service_id`, `commit_sha`) where `trigger` is `push` or `editor`. A repeated webhook delivery, or the push that follows an editor commit, fails with a unique violation; insert with `ON CONFLICT DO NOTHING` and skip.
- `deployments_one_active_per_service`: unique (`service_id`) where `status = 'active'`. Mark the old deployment `superseded` before the new one goes `active`, in one transaction.
- The `DESC` indexes on `deployments (service_id, queued_at)` and `events (project_id, created_at)` match a plain `ORDER BY … DESC` (nulls first), which is what Drizzle's `desc()` writes.
