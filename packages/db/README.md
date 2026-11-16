# @lift/db

The platform database: Drizzle schema, SQL migrations and seed. **Owner:** WS1 Back end & API. **Spec:** "Tables" in [docs/prd/01-backend-api.md](../../docs/prd/01-backend-api.md).

**Today:** the Drizzle and drizzle-kit setup with `createDb(url)` (postgres.js), and an empty schema.
**Next:** the v1 tables in BE-00, migrations and seed in BE-02.

| Command (from the repo root) | What it does |
| --- | --- |
| `pnpm db:generate` | Write a SQL migration into `packages/db/migrations` from changes in `src/schema.ts` |
| `pnpm db:migrate` | Apply migrations to `DATABASE_URL` |
| `pnpm db:seed` | Load the demo user, project, service and deployments |

Define columns in camelCase; `casing: "snake_case"` makes `githubId` the SQL column `github_id`. Migrations change only through the interface rule.
