# Esbert · Quality, demo and delivery

Nov 18, 2026. Your brief for Lift. Read [`docs/start-here.md`](../start-here.md) first; questions go to Hakim.

## What you own

Everything that proves Lift works and gets it submitted: the repo's rules and CI, the demo repos, the demo script and its automated test, the security checklist, the report, the slides and the video. The CLI moved to David. The details are in [`docs/prd/05-quality-delivery.md`](../prd/05-quality-delivery.md), everything except "The lift CLI".

You change only `.github/` (except `workflows/deploy.yml`, which is Hakim's), `e2e/`, `docs/demo.md`, `docs/report/`, `packages/config` and the root tooling files (`biome.json`, `turbo.json`, `tsconfig.base.json` and the root `package.json`). Hakim gives you admin rights on the repo for the settings below.

## Tasks

### QA-01 · Repo rules and CI (today, Nov 18)

- Pre-commit checks with lefthook, as PRD 05 describes.
- `CODEOWNERS` from the ownership table in `AGENTS.md`, with everyone's GitHub username.
- Pull request and issue templates, as PRD 05 describes.
- Branch protection on `main`: pull requests only, CI must pass, one approval. Leave "Do not allow bypassing the above settings" off, so Hakim can merge his own pull requests on green CI until Nov 26.
- With Hakim, before his deploy pipeline merges: a `production` environment that only the `main` branch can deploy to (Settings → Environments → Deployment branches → Selected branches and tags → `main`).
- `.github/workflows/ci.yml`: install from the lockfile with caching, then lint, typecheck, test and build, with Postgres and Redis as services and a gitleaks secret scan. Aim for under 8 minutes.

**Done when** a test pull request runs CI and can't be merged while CI is red.

### QA-02 · Demo organisation and repos (by Nov 19)

The `lift-demo` GitHub organisation, a bot account with a personal access token, and four small repos: `next-hello` (Next.js, no database), `express-postgres` (needs `DATABASE_URL`), `static-site`, and `broken-port` (listens on the wrong port, for the autofix demo). Add Lyse, who forks repos there for the AI test set.

### QA-07 · Demo script and security checklist (by Nov 22)

- `docs/demo.md`: each demo step with the exact repo, the click or command, what should appear, how long it takes, and the fallback if it fails on stage.
- The security checklist from PRD 05 as GitHub issues, one per item, each closed with its evidence.

### QA-10 · Report and slides (outline by Nov 21, drafts by Nov 27)

The report sections and the ten slides from PRD 05, in `docs/report/`. Ask each person for a paragraph on what they built, in their own words; Louisa supplies the visuals.

### QA-06 and QA-09 · End-to-end test of the demo (Nov 22–28)

Playwright tests in `e2e/` against the staging servers, signing in by exchanging the bot's token for a session. Add each demo step as it starts working; Hakim posts in the chat when one does. By Nov 28 the whole demo runs nightly in `.github/workflows/e2e.yml`.

### QA-04 · Review the deploy pipeline

Review Hakim's INF-07 pull request, which adds `.github/workflows/deploy.yml`, before it merges.

### QA-11 · Rehearsals, video and submission (Nov 26 – Dec 2)

Run the demo with the team every day from Nov 26 until it goes right three times in a row. Record the video on Nov 30: about 10 minutes at 1080p, with one continuous voice-over script read over the screen recording. Finish the report on Dec 1 and submit on Dec 2.

## How to work

- One task per branch: `esbert/QA-01-repo-rules`.
- Hakim reviews your pull requests.

## Kickoff prompt for your coding agent

```text
I'm Esbert. Read docs/start-here.md, docs/briefs/esbert-quality-delivery.md and
docs/prd/05-quality-delivery.md.

Task: <QA-XX> only. Change only the paths my brief lists.
1. Restate the task and list the files you will create or change.
2. Keep CI fast and deterministic, with no live model calls. Each end-to-end test maps to one demo
   step or one checklist item.
3. Tell me every setting I have to change by hand on GitHub, and where it is.

Finish with pnpm lint and one run of any workflow you changed, then summarise what changed.
```
