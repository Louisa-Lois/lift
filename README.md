# Lift

Deploy a GitHub repo in a few clicks, watch it run, let an AI agent fix what breaks, and edit the code together live. A Web Technologies final project at Ashesi University, due Dec 2, 2026.

**New to the repo? Read [docs/start-here.md](docs/start-here.md) first.**

## Quick start

You need Node.js 24 (`nvm use`), pnpm 10 (`npm install -g pnpm@10`) and Docker.

```bash
pnpm install
pnpm env:init      # creates .env with fresh development secrets
pnpm stack:up      # Postgres, Redis, BuildKit and Traefik in Docker
pnpm dev           # web, api, agent, collab and worker
```

Then open http://localhost:3000. The API answers at http://localhost:3000/api/v1/health, proxied to port 4000.

Signing in (from BE-03) needs your own GitHub OAuth app; `.env.example` explains how to register one.

## What's where

| Path | What it is | Workstream |
| --- | --- | --- |
| `apps/web` | Next.js dashboard and live editor | WS2 Front end |
| `apps/api` | Fastify REST API, auth, deployments, live events, internal API | WS1 Back end & API |
| `apps/collab` | Hocuspocus server for the live editor | WS1 Back end & API |
| `apps/agent` | AI service: planner, autofix, ops chat | WS3 AI agent |
| `apps/mcp` | MCP server so coding agents can use Lift | WS3 AI agent |
| `apps/worker` | Builds images, runs containers, ships logs and metrics | WS4 Infrastructure & worker |
| `apps/cli` | The `lift` command-line tool | WS5 CLI, quality & delivery |
| `packages/shared` | Contracts every app shares: IDs, schemas, events, jobs, typed client | Everyone |
| `packages/db` | Drizzle schema, migrations and seed | WS1 Back end & API |
| `packages/config` | Shared TypeScript presets | WS5 CLI, quality & delivery |
| `infra/` | Terraform, Compose stacks, Traefik, scripts | WS4 Infrastructure & worker |
| `evals/` · `e2e/` | AI evaluation · end-to-end demo test | WS3 · WS5 |
| `docs/` | Contracts, PRDs, decisions, demo script | Everyone |

Each app's README says what it does today and which requirement comes next.

## Working here

- [docs/contracts.md](docs/contracts.md) holds the shared contracts and team rules; [docs/prd/](docs/prd/) holds one PRD per workstream.
- [AGENTS.md](AGENTS.md) is the brief every coding agent reads.
- Run `pnpm check` (lint, typecheck, test) before every pull request.
