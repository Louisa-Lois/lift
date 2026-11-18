# David · The lift CLI

Nov 18, 2026. Your brief for Lift. Read [`docs/start-here.md`](../start-here.md) first; questions go to Hakim.

## What you own

The `lift` command-line tool in `apps/cli`: sign in, link a folder to a project, deploy, follow logs, and manage variables and databases, all from the terminal. It's how developers and coding agents use Lift without opening the dashboard, and it gets its own moment in the demo.

The CLI talks to the API only through the typed client in `@lift/shared` (`createLiftClient`). So you can build and test every command now against sample data (`@lift/shared/fixtures`), then point it at the real API as Hakim's routes come online. The full spec is "The lift CLI" in [`docs/prd/05-quality-delivery.md`](../prd/05-quality-delivery.md): every command, flag, exit code and file it uses.

You change only `apps/cli`. If the typed client is missing something you need, ask Hakim instead of editing `packages/shared`; he only ever adds to the parts you use.

## Tasks

### QA-03 · The skeleton (by Nov 20)

`lift login --token`, `lift logout`, `lift whoami` and `lift status`; the global flags `--api-url`, `--project`, `--service` and `--json`; exit codes 0 to 4; the token saved in `~/.lift/config.json` with file mode 600.

Build against a mocked API: Mock Service Worker in Node (`msw/node`) answering with the fixtures. Hakim adds API tokens on Nov 22; from then on, test against the real API as well, running it locally as `docs/start-here.md` shows.

**Done when** `lift whoami --json` and `lift status --json` print JSON that matches the schemas, against the mocks now and the real API from Nov 22.

### QA-05 · Everyday commands (by Nov 24)

`lift link`, `lift up` (deploy the current commit and stream the build log until it's live or fails), `lift logs` (`--follow`, `--since 1h`, `--search`, `--deployment`), `lift env` (list, `set`, `unset`), `lift db add postgres`, `lift db list`, `lift rollback`, `lift redeploy` and `lift restart`.

Switch each command to the real API when Hakim says its route is live: deploying from Nov 21; variables, Postgres and rollback from Nov 22.

**Done when** `lift login --token … && lift link && lift up`, run in a clone of a demo repo, prints the live URL and exits 0, and a deploy that fails exits 4.

### After the handoff (Nov 26–28)

- **QA-08 · Browser login and AI commands:** `lift login` through the browser approval page, `lift init` (asks the AI for a deployment plan and applies it), and `lift ask` if the ops chat ships.
- **API hardening, if time:** rate limits (BE-21) and the permission test sweep, in `apps/api`, once Hakim gives the go-ahead.

## Rules

- Every error says what to do next, for example "Not signed in. Run `lift login`."
- `--json` output has no colour or spinners, so scripts and agents can parse it.
- Never print a token.

## How to work

- One task per branch: `david/QA-03-cli-skeleton`.
- Tests first: argument parsing, normal and `--json` output, exit codes.
- Hakim reviews your pull requests.
- To use it from your own terminal: `pnpm --filter cli build && npm install -g ./apps/cli`, then run `lift`.

## Kickoff prompt for your coding agent

```text
I'm David. Read docs/start-here.md, docs/briefs/david-cli.md and the "The lift CLI" section of
docs/prd/05-quality-delivery.md.

Task: <QA-XX> only, in apps/cli. Talk to the API only through createLiftClient from @lift/shared,
and never edit packages/shared.
1. Restate the task and list the files you will create or change.
2. Write the tests first (argument parsing, normal and --json output, exit codes) against a mocked
   API built with msw/node from @lift/shared/fixtures, and show me that they fail.
3. Implement until they pass.

Rules: every error message says what to do next; --json output has no colour or spinners; never
print a token; save it with file mode 600.

Finish with pnpm lint && pnpm --filter cli typecheck && pnpm --filter cli test, then summarise what
changed and how to try it.
```
