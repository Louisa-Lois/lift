# ADR 0001: Monorepo tooling

Nov 16, 2026 · Accepted

## Context

Five people, each with a different coding agent, build seven apps and three packages in sixteen days. The tooling has to keep those agents consistent, keep checks fast, and need no attention after day one.

## Decisions

- **pnpm workspaces with a version catalog.** One lockfile. Libraries used by more than one package take their version from `catalog:` in `pnpm-workspace.yaml`, so two apps never run different versions of Zod or Vitest. pnpm 10 is pinned in `packageManager` and switches itself to that version.
- **Turborepo** runs tasks across packages and caches the results. `typecheck` and `test` depend on a `transit` task, so a change in `packages/shared` invalidates the caches of every app that imports it.
- **Biome** for linting and formatting: one fast tool instead of ESLint and Prettier configs to keep in sync. Markdown is excluded so the docs keep their hand-written tables.
- **TypeScript 6, not 7.** TypeScript 7, the native compiler, is the "latest" release on npm but ships no JavaScript API, which Next.js's build-time type check and drizzle-kit both need. Revisit once Next.js supports 7.
- **Workspace packages ship TypeScript source.** `@lift/shared` and `@lift/db` export `.ts` files with no build step: Next.js compiles them through `transpilePackages`, tsx runs them in development, Vitest transforms them, and tsup bundles them into each Node app's `dist`. Nobody runs a watch process for a package.
- **Bundler module resolution with extensionless imports**, since every runtime path goes through a bundler or tsx.
- **tsup 8 for the Node apps**: one ESM file per entry, targeting Node 24. tsup 9 was a month old; 8.x is the version every agent knows.
- **Vitest 5** in every package; Playwright for the end-to-end demo test (WS5).
- **One `.env` at the repo root** in development, read by `tsx --env-file-if-exists`, `next.config.ts` and `drizzle.config.ts`. `pnpm env:init` creates it with generated secrets. In production, Compose supplies the variables.
- **postgres.js 3 under Drizzle.** postgres.js 4 was two weeks old, and Drizzle is tested against 3.
- **Each server picks its listen address from `HOST`**, defaulting to `127.0.0.1` in development and `0.0.0.0` when `NODE_ENV=production`, so containers are reachable without exposing laptops on campus Wi-Fi.

## Consequences

- Imports stay extensionless and types use `import type`; Biome enforces both.
- A Node app lists every npm package that its bundled workspace code needs at runtime.
- The tsconfig presets are extended by relative path, because Vite does not resolve `extends` through pnpm's symlinks.
