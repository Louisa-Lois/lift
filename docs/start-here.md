# Start here

Nov 16, 2026. Read this page, then [contracts.md](contracts.md), then your own PRD in [prd/](prd/).

## What's in the repo today

The starter repo. Every app and package in `docs/contracts.md` exists, starts, answers a health check and passes `pnpm check`; each one's README says what it does today and which requirement comes next. Nothing beyond that is built yet.

The shared contracts in `packages/shared` come next, as one pull request (BE-00) that every owner reviews before they freeze on Nov 18. Until then, build what doesn't depend on them, and wait for them before writing your own types.

## Set up your machine

1. Install Node.js 24, pnpm 10 (`npm install -g pnpm@10`), Docker and your coding tool.
2. Clone the repo and run:

   ```bash
   pnpm install
   pnpm env:init      # creates .env with fresh development secrets
   pnpm stack:up      # Postgres and Redis in Docker
   pnpm dev           # web, api, agent, collab and worker
   ```

   http://localhost:3000 should show the placeholder page, and http://localhost:3000/api/v1/health should answer `{"status":"ok"}`.
3. Register your own GitHub OAuth app and put its ID and secret in `.env`; the steps are in `.env.example`. You need it once sign-in lands (BE-03, Nov 19).
4. Open the repo in your coding tool. It reads `AGENTS.md`: Codex and Cursor directly, Claude Code through `CLAUDE.md`, Gemini CLI through `GEMINI.md`.

## Your first tasks

### Back end & API (Team Member 1, with Team Member 4)

- **First:** BE-00, the shared contracts and the v1 database schema, as one pull request every owner reviews, tagged `contracts-v1` on Nov 18.
- **Then:** routes in the order the front end needs them: sign-in, projects, services, deployments, the log stream (BE-01 to BE-08, by Nov 19).

### Front end (Team Member 2)

- **Now:** spend an hour in the Railway, Vercel and Render dashboards with the design table from your PRD open.
- **First tasks:** FE-01 (app frame, colours, fonts, shadcn/ui and the switch that turns mocks on). Then the log viewer from FE-05: it appears on four screens, and the PRD's fake log stream lets you finish it before the API exists.
- **Works against:** mocks built from the sample data in `packages/shared` once BE-00 lands; each screen moves to the real API as its routes ship.

### AI agent (Team Member 3)

- **Now:** get an Anthropic API key with a monthly spending cap. Shortlist the 30 evaluation repos and fix the exact commit of each.
- **First tasks:** AI-00, the plan, action and diagnosis schemas, as a pull request into `packages/shared` reviewed by Team Member 1 (due Nov 18). Then AI-01; `apps/agent` already runs.
- **Works against:** saved copies of a few repos' files and recorded model replies, so tests never call the model.

### Infrastructure & worker (Team Member 4, with Team Member 1)

- **Now (INF-00):**
  - Buy the domain and move it to Cloudflare first; the switch can take up to a day.
  - Set up the AWS account and the budget alarm.
  - Check what the credits allow: regions, instance sizes and the EC2 vCPU limit. Demo week needs 6 vCPUs across the two servers.
- **First tasks:**
  - Agree the job payloads and internal routes with Team Member 1 before the Nov 18 freeze.
  - INF-06: add BuildKit and the `*.apps.localhost` Traefik to `infra/compose/dev.yml`.
  - INF-01: Terraform for the two servers.
  - INF-04 and INF-05: the build and deploy jobs on local Docker.
- **Works against:** test jobs queued by a small script and a tiny fake of the internal API, so the worker runs before the real routes do.

### CLI, quality & delivery (Team Member 5)

- **Now:** QA-02, the `lift-demo` GitHub org, the bot account and the four demo repos. Then turn every requirement ID in the PRDs into a GitHub issue, grouped by the Nov 19, 23 and 28 checkpoints, so the team works off one board.
- **First tasks:** the rest of QA-01 on top of this repo: pre-commit checks, `ci.yml`, CODEOWNERS, pull request and issue templates, branch protection. The root tooling (Biome, Turborepo, the TypeScript presets) is already here and is yours from now on. Then QA-03; `apps/cli` already runs.
- **Works against:** a mocked API in the CLI's tests, built from the same sample data.

## How to work with your coding agent

1. Pull `main`, then create a branch named `ws{N}/{REQ-ID}-short-name`.
2. Paste the kickoff prompt from the end of your PRD, with one requirement ID.
3. Read the agent's plan before it writes code. If it reaches outside your folders or into `packages/shared`, stop it and open an `interface` issue instead.
4. Once `pnpm check` passes, open a pull request the same day, reviewed by the person your PRD names. Keep pull requests small, merge daily, and update your branch from `main` each morning.

## Rhythm

- A 10-minute check-in at the same time every day (a group-chat message works): what got merged, what's next, what's blocked.
- If you're blocked on another workstream, build against mocks and say so in the check-in.
- Checkpoints: **Nov 18** contracts frozen · **Nov 19** hello world live · **Nov 23** everything works by hand · **Nov 28** AI and editor done · **Nov 29 to Dec 1** freeze · **Dec 2** submission. At each checkpoint everyone runs through the demo together.
