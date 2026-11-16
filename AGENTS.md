# AGENTS.md

The brief every coding agent reads before working in this repo: Claude Code, Codex, Cursor, Gemini CLI and any other. `CLAUDE.md` and `GEMINI.md` only import this file. Keep one brief for every tool: edit this file, never fork it.

## What Lift is

Lift is a deployment platform in the style of Railway or Render, with an AI layer. A user connects a GitHub repo; Lift builds it into a container image, runs it at its own HTTPS address, streams its logs and metrics, and provisions Postgres or Redis for it. An AI agent plans the deployment from the repo, fixes failed builds, answers questions and takes approved actions. A live editor lets several people edit the code together and deploy their commit. Five students build it for a Web Technologies final project due Dec 2, 2026.

## Read first

1. `docs/contracts.md`: layout, stack, the shared contracts (data model, IDs, API rules, streams, job queues, internal API), ports and team rules.
2. Your workstream's PRD in `docs/prd/`: scope, requirement IDs with dates, acceptance tests and the kickoff prompt.
3. `docs/adr/`: why the tooling is set up the way it is.

## Who owns what

| Path | Workstream |
| --- | --- |
| `apps/api`, `apps/collab`, `packages/db` | WS1 Back end & API |
| `apps/web` | WS2 Front end |
| `apps/agent`, `apps/mcp`, `evals/` | WS3 AI agent |
| `apps/worker`, `infra/` | WS4 Infrastructure & worker |
| `apps/cli`, `e2e/`, `.github/`, `packages/config`, root tooling files, `docs/demo.md` | WS5 CLI, quality & delivery |
| `packages/shared` | Everyone, through the interface rule |

Edit only the paths your task's workstream owns. `packages/shared`, `packages/db` migrations and `infra/` change only through an issue labelled `interface`, approved by the owner of every workstream that uses what changes. If a task seems to need a change outside your paths, stop and say what you need instead of making it.

## Commands

Run them from the repo root.

| Command | What it does |
| --- | --- |
| `pnpm install` | Install everything; pnpm switches itself to the version pinned in `package.json` |
| `pnpm env:init` | Create `.env` from `.env.example` with fresh development secrets; re-run when `.env.example` changes |
| `pnpm stack:up` · `pnpm stack:down` | Start or stop Postgres and Redis in Docker |
| `pnpm dev` | Run web (3000), api (4000), agent (4100), collab (4200) and worker together |
| `pnpm --filter <app> dev` | Run one app, for example `pnpm --filter web dev` |
| `pnpm lint` · `pnpm format` | Check with Biome · fix formatting and import order |
| `pnpm typecheck` | TypeScript in every package |
| `pnpm test` · `pnpm --filter <app> test` | Vitest everywhere · in one app |
| `pnpm build` | Build every app |
| `pnpm check` | Lint, typecheck and test; must pass before every pull request |
| `pnpm db:generate` · `pnpm db:migrate` · `pnpm db:seed` | Write a migration from the schema · apply migrations · load demo data |

## How to work

1. One requirement ID per task, on a branch named `ws{N}/{REQ-ID}-short-name`, for example `ws2/FE-07-variables-tab`.
2. Before writing code, restate the requirement and list the files you will create or change.
3. Write the tests for its acceptance criteria first and see them fail.
4. Implement until they pass, then run `pnpm check`.
5. Commit with Conventional Commits: `feat(api): add rollback endpoint`, `fix(web): …`, `chore(infra): …`.
6. The pull request names the requirement ID, says what changed and how to try it, and states `agent-written: yes` and `contract change: yes/no`.

## Code rules

- TypeScript strict, ES modules, imports without file extensions. Use `import type` for types; `pnpm format` fixes it.
- Every request and response schema, enum, ID, event and job payload comes from `@lift/shared`. Never redefine one locally; if one is missing, open an `interface` issue.
- IDs are `prefix_` plus 24 lowercase letters and digits, created only by `packages/shared`.
- JSON is camelCase, SQL columns snake_case (Drizzle maps them with `casing: "snake_case"`), enum values lowercase.
- API errors are `application/problem+json` with a stable `code`; the codes are listed in `docs/contracts.md`.
- Every app validates its environment with Zod in `src/env.ts` and refuses to start on bad config. A new variable goes into that schema and into `.env.example`, with a comment.
- Secrets never go in git, prompts, logs, fixtures or test snapshots. Never log tokens, cookies or variable values.
- Tests live in each package's `test/` folder and run without the internet: GitHub and the model are mocked or recorded. API tests may use the Postgres and Redis from `pnpm stack:up`.
- Add a dependency with `pnpm --filter <app> add <name>` and say why in the pull request. When a second package needs the same library, move its version into the `catalog:` in `pnpm-workspace.yaml` and use `"catalog:"` in both.

## Things that trip agents up

- Node 24 (`.nvmrc`). TypeScript stays on 6.x: TypeScript 7 has no JavaScript API yet, and Next.js and drizzle-kit need one.
- Workspace packages (`@lift/shared`, `@lift/db`) export TypeScript source and have no build step. Next.js compiles `@lift/shared` through `transpilePackages`; the Node apps are bundled by tsup, which inlines `@lift/*` but leaves npm packages external. So if code you import from a workspace package needs an npm package at runtime, your app must list that package too.
- Extend the tsconfig presets by relative path (`../../packages/config/tsconfig/node.json`), not by package name: Vite, which runs Vitest, does not follow pnpm's symlinks there.
- In development every app reads the one `.env` at the repo root; nothing reads `apps/*/.env`.
- `apps/web` has no server actions and no API routes of its own. The API is a separate service at `/api/v1`: proxied to port 4000 in development, routed by Traefik in production.
- Internal routes (`/internal/v1/…`) listen only on the control plane's private IP and are never routed by Traefik.
- The collab server refuses every connection until BE-17 adds token authentication.
