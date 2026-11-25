# Lift AI evaluations

`repos.json` contains pinned repository cases and their expected plans. Healthy cases can be used to evaluate the planner without the `lift-demo` sample-fork organization. Broken variants and prompt-attack cases are not included in this healthy-only work.

## Run healthy planner cases

Requirements: Node.js 24, the local Lift stack running, and a Lift personal access token with the `admin` scope, which the plans endpoint requires for writes.

A full run sends 20 plans. The agent's default daily budget is 300,000 input tokens; if needed, raise `AGENT_DAILY_TOKEN_BUDGET` in the repo-root `.env` before starting or restarting the local Lift stack. For example, set it to `1000000`.

```powershell
$env:LIFT_TOKEN = "lift_pat_..."
pnpm eval
pnpm eval --only next-postgres-tecsmith-01
pnpm eval --concurrency 3
```

On macOS or Linux, set the same variables in Bash:

```bash
LIFT_TOKEN=lift_pat_... pnpm eval
```

The API base defaults to `http://localhost:3000/api/v1`; set `LIFT_API_URL` to use another local Lift API. The runner submits one plan request per healthy case, passing the pinned SHA as `commitSha`; the API keeps the repository's default branch while reading that exact commit. The runner checks that the API returns the same SHA. Each request creates a plan draft in the Lift API. The runner does not apply plans or deploy services.

It scores service count, service type, port (for web services), equivalent start commands, database types, and recall of required variable keys. Equivalent commands include `npm start`/`npm run start` (and the corresponding pnpm and yarn forms), with `$PORT`, `${PORT}`, or `${PORT:-...}` matched to the planned port. Every selected case stays in the plan-accuracy denominator; API errors count as misses. Problem responses retain their code and detail for diagnosis. Each run is written to `evals/results/` with variable values omitted. Cases with a non-null `breakage` are skipped. This runner does not yet measure deployment success, autofix, or prompt-injection resistance.

## Case format

Each case in `repos.json` has a stable `id`, public `repo`, pinned commit `ref`, stack label, expected `golden` plan, and `breakage` metadata (`null` for healthy cases). The expected values should be checked against the pinned repo's manifests, runtime configuration, and documentation.
