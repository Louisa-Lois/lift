import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// One .env at the repo root serves every app in development (pnpm env:init creates it).
if (existsSync("../../.env")) process.loadEnvFile("../../.env");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  // TypeScript keys are camelCase, SQL columns snake_case (docs/contracts.md).
  casing: "snake_case",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://lift:lift@localhost:5432/lift",
  },
  strict: true,
  verbose: true,
});
