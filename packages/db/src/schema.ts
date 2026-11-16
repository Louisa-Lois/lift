/**
 * The platform database schema (Drizzle ORM).
 *
 * BE-00 adds the v1 tables listed in docs/prd/01-backend-api.md; `pnpm db:generate` then writes
 * the SQL migration into packages/db/migrations. Define columns in camelCase: both drizzle-kit and
 * the client use `casing: "snake_case"`, so `githubId` becomes the column `github_id`.
 */
export {};
