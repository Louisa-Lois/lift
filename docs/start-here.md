# Start here

Updated Nov 18, 2026. Read this page, then your brief in [briefs/](briefs/). Hakim builds from [contracts.md](contracts.md) and the PRDs in [prd/](prd/).

## How we're building Lift

Hakim builds the whole demo path himself, with Claude Code, until it works end to end (target Nov 26): the API, the worker, the servers, the dashboard, the AI planner and autofix, and the live editor. Fitting five people's parts together was the biggest risk in the plan, so one person owns everything that has to fit together.

Everyone else works in parallel on parts that don't touch his code, then takes over polish after the handoff on Nov 26. Each brief lists your tasks with dates, the folders you may change, and a kickoff prompt for your coding agent.

## Who's who

| Person | Until Nov 26 | From the handoff on Nov 26 | Brief |
| --- | --- | --- | --- |
| Hakim | Builds the demo path end to end | Fixes what breaks as everyone's work lands; reviews pull requests | The PRDs in [prd/](prd/) |
| Louisa | Brand, theme and the landing page | Polishes the dashboard; visuals for the report, slides and video | [louisa-design.md](briefs/louisa-design.md) |
| David | The `lift` CLI, against sample data first | CLI browser login and AI commands; API hardening if time | [david-cli.md](briefs/david-cli.md) |
| Lyse | The AI test set and the AI's instructions | Runs the evaluation and improves the prompts | [lyse-ai-evals.md](briefs/lyse-ai-evals.md) |
| Esbert | Repo rules, CI, demo repos, demo script, report outline | End-to-end tests, rehearsals, video, submission | [esbert-quality-delivery.md](briefs/esbert-quality-delivery.md) |

## Dates

| When | Hakim's demo path | Everyone else |
| --- | --- | --- |
| Nov 18 | Shared contracts (BE-00); servers planned | Start the first task in your brief |
| Nov 19–21 | Deploying works: sign in, pick a repo, build it, live at its own address, live logs. Locally first, then on the servers | Brand and theme in code; CLI basics; the AI test set; demo repos and CI |
| Nov 22 | Variables, Postgres, rollback, API tokens | CLI moves to the real API; prompt drafts; demo script v1 |
| Nov 24 | AI plan from a pasted repo URL; autofix of the three seeded failures | Landing page done; evaluation runs start |
| Nov 26 | Live editor: two people, one file, commit and deploy. **The demo path is complete: handoff** | Polish starts; CLI browser login; end-to-end tests |
| Nov 27–28 | Fixes as everyone's work lands; extras only if there's time | Polish, final evaluation numbers, report and slide drafts |
| Nov 29 – Dec 1 | Freeze: fixes only | Daily demo runs, video on Nov 30, report final on Dec 1 |
| Dec 2 | Submission | |

When a date slips, Hakim drops extras first: ops chat, the MCP server, Redis, metrics and usage, then CLI browser login.

## Set up your machine

1. Install Node.js 24, pnpm 10 (`npm install -g pnpm@10`), Docker and your coding tool.
2. Clone the repo and run:

   ```bash
   pnpm install
   pnpm env:init      # creates .env with fresh development secrets
   pnpm stack:up      # Postgres, Redis, BuildKit and Traefik in Docker
   pnpm dev           # web, api, agent, collab and worker
   ```

   http://localhost:3000 should show the start page, and http://localhost:3000/api/v1/health should answer `{"status":"ok"}`.
3. To sign in to your local copy once sign-in lands (Nov 19–21), register your own GitHub OAuth app and put its ID and secret in `.env`; the steps are in `.env.example`.
4. Open the repo in your coding tool. It reads `AGENTS.md`: Codex and Cursor directly, Claude Code through `CLAUDE.md`, Gemini CLI through `GEMINI.md`.

## How to work with your coding agent

1. Pull `main`, then create a branch named after yourself and your task: `louisa/UI-02-landing-page`.
2. Paste the kickoff prompt from your brief, with one task ID.
3. Read the agent's plan before it writes code. It must stay inside the folders your brief lists; if it needs something outside them, stop and ask Hakim.
4. Once `pnpm check` passes, open a pull request the same day. Hakim reviews it. Keep pull requests small, and update your branch from `main` each morning.

## Rhythm

- A 10-minute check-in at the same time every day (a group-chat message works): what got merged, what's next, what's blocked.
- Hakim posts in the chat when a piece of the demo path starts working, so whoever is waiting on it can switch from sample data to the real thing.
- From Nov 26 the whole team runs through the demo together every day.
