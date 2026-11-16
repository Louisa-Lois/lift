# PRD 5 · CLI, quality & delivery

> Read together with `docs/contracts.md`. Owner: Team Member 5. Paste the kickoff prompt at the bottom into your coding agent to start.

## Goal, scope and inspiration

**WS5 builds the `lift` command-line tool and owns everything that proves the product works and gets it submitted: repo tooling, CI, the end-to-end demo test, the security checklist, the demo script and video, the slides and the report.** Tooling is live on Nov 16; the full demo runs in CI by Nov 28.

- **Owner:** Team Member 5, who also floats to whichever workstream falls behind. **Reviewers:** each owner for their part of the demo.
- **Owns:** `apps/cli`, `e2e/`, `.github/` (WS4 co-owns the deploy job), `packages/config`, `docs/demo.md`, the report and the slides.

| Inspiration | What we take |
| --- | --- |
| Railway CLI (`railway up`, `link`, `logs`) | Linking a folder to a project; one command that deploys and follows the logs |
| Vercel CLI | Browser login with a code; a link file in the repo that is added to `.gitignore` automatically |
| flyctl, Heroku CLI | `status`, `open`, `logs --follow` and `env set` ergonomics; clear exit codes |
| GitHub CLI | `--json` output for scripts and agents; errors that say what to run next |

**In scope:** the CLI; workspace tooling (Biome, Turborepo, TypeScript presets); CI workflows; branch protection, CODEOWNERS and templates; the Playwright end-to-end demo test; contract tests; the security and abuse checklist; the demo script, fallback account and video; slides; report; submission.

**Out of scope:** publishing the CLI to npm (stretch); load testing beyond WS4's check.

## The lift CLI

A single Node binary (`apps/cli`, bundled with tsup), built on `commander`, with `@clack/prompts` for interactive steps and `picocolors` for colour. It talks only to the public API, through the typed client in `packages/shared`.

| Command | What it does | API |
| --- | --- | --- |
| `lift login` | Starts a CLI login, prints the code, opens `/cli-auth?code=…` in the browser, polls every 2 s for up to 5 minutes, saves the token. `--token lift_pat_…` skips the browser, for CI | `/auth/cli` |
| `lift logout` · `lift whoami` | Remove the saved token · show the signed-in user | `/me` |
| `lift init` | In a git repo with a GitHub remote: name the project, ask the AI for a plan (`--no-ai` for the manual form), show it as a table, apply on confirm, link the folder | `/agent/plans`, apply |
| `lift link` | Pick an existing project and service; writes `.lift/project.json` and adds `.lift/` to `.gitignore` | projects, services |
| `lift up` | Deploys the current commit of the linked service (warns if it is not pushed), then streams build logs until `active` or `failed` | deployments, log stream |
| `lift logs` | Runtime logs; `--deployment <id>` for build logs; `--follow`, `--since 1h`, `--search <text>` | logs |
| `lift status` | Table of services: name, status, URL, last deploy | project, services |
| `lift open` | Opens the service URL; `--dashboard` opens the dashboard already signed in | `/auth/session` |
| `lift env` · `env set KEY=VALUE…` · `env unset KEY` | List (masked; `--reveal`), set, remove variables; reminds you to run `lift up` | variables |
| `lift db add postgres` · `lift db add redis` · `lift db list` | Add or list databases | databases |
| `lift rollback [deploymentId]` | Roll back to that deployment, or to the previous active one | rollback |
| `lift redeploy` · `lift restart` | Redeploy the current commit · restart the container | deployments, restart |
| `lift ask "…"` | One question to the project's assistant, streamed (good for the demo) | agent messages |

**Conventions**

- Global flags: `--project`, `--service`, `--api-url`, and `--json` for machine-readable output (no colour, no spinners) that scripts and agents can parse.
- Exit codes: `0` success, `1` error, `2` usage error, `3` not signed in, `4` deployment failed.
- Config in `~/.lift/config.json` (`apiUrl`, `token`, `user`; mode 600); link file `.lift/project.json` (`projectId`, `serviceId`).
- Every error says what to do next, for example "Not signed in. Run `lift login`."
- Team install: `pnpm --filter cli build && npm install -g ./apps/cli`.

## Repo tooling, CI and testing strategy

### Set up on Nov 16, before anyone writes features

- Workspace: `pnpm-workspace.yaml`, `turbo.json` (tasks `build`, `dev`, `lint`, `typecheck`, `test`, `eval`), `biome.json`, `tsconfig.base.json`, and presets in `packages/config`.
- Pre-commit with lefthook: Biome on staged files and a typecheck of changed packages.
- `AGENTS.md`, `CLAUDE.md` and `GEMINI.md` as described in `docs/contracts.md`.
- `CODEOWNERS`: `apps/web` to TM2; `apps/api`, `apps/collab` and `packages/db` to TM1; `apps/agent`, `apps/mcp` and `evals` to TM3; `apps/worker` and `infra` to TM4; `apps/cli`, `e2e`, `.github` and `packages/config` to TM5; `packages/shared` to all five.
- Branch protection on `main`; a PR template (what and why, requirement ID, screenshots, tests, "agent-written: yes/no", "contract change: yes/no"); issue templates for bugs, requirements and interface changes.

### CI workflows

| Workflow | When | What |
| --- | --- | --- |
| `ci.yml` | Every PR and push to `main` | Install from the frozen lockfile with caching; Turborepo `lint`, `typecheck`, `test` and `build` for affected packages; Postgres and Redis service containers for API tests; the worker's Docker integration test on the runner; a gitleaks secret scan. Target: under 8 minutes |
| `e2e.yml` | Nightly at 02:00 UTC, on demand, and on milestone tags | The Playwright demo test against staging; uploads the report and video; posts the result to the team chat |
| `deploy.yml` | Push to `main` (with WS4) | Build and push images, run migrations, roll out to both VMs |

### Testing strategy

| Layer | Tool | Written by | Covers |
| --- | --- | --- | --- |
| Unit | Vitest | each workstream | State machine, crypto, slugs, plan validation, label generation, CLI argument parsing |
| API integration | Vitest with real Postgres and Redis | WS1 | Every route, role checks, webhooks, streams |
| Worker integration | Vitest with Docker | WS4 | Building and running a fixture app; limits; cleanup |
| Contract | the shared Zod schemas | WS5 sets up, everyone uses | API responses are validated against the schemas in tests, and MSW mocks are built from the same schemas, so any drift breaks a test |
| AI | Recorded responses plus `pnpm eval` | WS3 | Parsing and guardrails; quality through the 30-case evaluation |
| End to end | Playwright | WS5 with WS2 | The demo script, steps 1 to 8, on staging |

**Test accounts and repos.** A GitHub organisation `lift-demo` with a bot user and small repos used everywhere: `next-hello` (Next.js, no database), `express-postgres` (needs `DATABASE_URL`), `static-site`, and `broken-port` (listens on the wrong port, for autofix). End-to-end tests sign in by exchanging the bot's personal token for a session (`POST /api/v1/auth/session`), so no browser OAuth is automated.

## Security checklist, demo, report and delivery

### Security and abuse checklist (WS5 verifies with each owner)

- [ ] Variables are encrypted at rest (inspect the column after a demo run)
- [ ] No secret appears in any log after a full demo run (search for the known test values)
- [ ] Internal routes return nothing from the internet; Redis and Postgres ports are closed to the public
- [ ] App containers cannot reach the metadata endpoint, the control plane or port 25 (WS4's test)
- [ ] Webhooks with bad signatures are rejected
- [ ] A viewer cannot write anywhere (WS1's generated test sweep)
- [ ] Rate limits answer `429` with code `rate_limited`
- [ ] Prompt-injection cases pass (WS3's evaluation)
- [ ] The dashboard sends CSP and frame headers
- [ ] `pnpm audit --prod` shows no critical issues and gitleaks is clean
- [ ] AWS budget alerts arrive and the stop action works in a dry run

### Demo

- `docs/demo.md` is the source of truth: the eight steps from the proposal, with the exact repo and branch for each, the click or command, what should appear, how long it takes, and the fallback.
- A fallback account holds a project already at each step, so any single failure on stage can skip to the next state.
- Rehearse daily from Nov 24 with `pnpm demo:check` (the end-to-end test) and one human run; three green runs in a row before Dec 2.
- **Video:** recorded on Nov 30 at 1080p, about 10 minutes, with the voice-over written as one continuous script read over the screen recording, not line-by-line pointing cues.

### Slides (10)

Problem · What Lift does · Live demo · Architecture · The AI layer and its eval numbers · The live editor · Hardest engineering problems · What we learned · Who built what · What's next.

### Report

Problem and users · Architecture and decisions (linking `docs/adr`) · The AI layer and evaluation results with numbers · The live editor · Testing and security · What broke and what we learned · Individual contributions by workstream · Future work. Drafted from Nov 24, final on Dec 1.

### Submission on Dec 2

- [ ] Repository access for the lecturer, with a README covering setup
- [ ] Live URL with a test account and its credentials
- [ ] Video link
- [ ] Report PDF
- [ ] Slides

## Requirements, acceptance tests and agent kickoff prompt

### By Nov 16 and 17

- [ ] **QA-01** Workspace tooling, pre-commit, agent brief files, CODEOWNERS, templates, branch protection, `ci.yml`
- [ ] **QA-02** GitHub organisation `lift-demo`, the bot user and the four demo repos

### By Nov 19 (hello world live)

- [ ] **QA-03** CLI skeleton: `login --token`, `whoami`, `status`, `--json`, exit codes
- [ ] **QA-04** `deploy.yml` with WS4, so staging receives every merge

### By Nov 23 (everything works by hand)

- [ ] **QA-05** CLI `link`, `up`, `logs`, `env`, `db`, `rollback`, `redeploy` and `restart` against the real API
- [ ] **QA-06** Playwright: the manual demo path (sign in, deploy, variables, database, rollback)
- [ ] **QA-07** Security checklist v1 and `docs/demo.md` v1

### By Nov 28 (AI and editor done)

- [ ] **QA-08** CLI browser login, `init` with the AI plan, and `ask`
- [ ] **QA-09** Playwright: the full demo, including the editor in two browser contexts and the AI steps; `e2e.yml` running nightly
- [ ] **QA-10** Slides and report drafts; fallback account prepared

### Freeze (Nov 29 to Dec 1) and Dec 2

- [ ] **QA-11** Daily demo runs; video recorded Nov 30; report final Dec 1; submission Dec 2

### Acceptance tests

- From a fresh clone of `next-hello`, `lift login --token … && lift link && lift up` prints the live URL and exits `0`; on a failing repo it exits `4`.
- Every command's `--json` output parses and matches its schema.
- CI finishes in under 8 minutes on a typical PR.
- The end-to-end demo test passes three runs in a row on staging.
- Every security checklist item is ticked, with its evidence linked in the issue.

### Agent kickoff prompt

```text
You are working in the Lift monorepo. Before anything else, read AGENTS.md, docs/contracts.md
and docs/prd/05-quality-delivery.md.

Scope: apps/cli, e2e/, .github/, packages/config, docs/demo.md. The CLI uses only the typed
client in packages/shared.

Task: implement requirement <QA-XX> only.
1. Restate it and list the files and commands involved.
2. For CLI work, write tests first (argument parsing, output in both human and --json modes,
   exit codes) against a mocked API.
3. For CI and tests, keep runs fast and deterministic; no live model calls in CI.

Rules: every error message says what to do next; --json output has no colour or spinners;
secrets are never printed; tokens are stored with mode 600.

Finish with `pnpm lint && pnpm typecheck && pnpm --filter cli test` (or one run of the workflow
you changed), then summarise what changed and how to use it.
```
