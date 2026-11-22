# Lift AI evaluations

`repos.json` contains pinned repository cases and their expected plans. Healthy cases can be used to evaluate the planner without the `lift-demo` sample-fork organization. Broken variants and prompt-attack cases are not included in this healthy-only work.

## Run healthy planner cases

Requirements: Node.js 24, the local Lift stack running, and a Lift personal access token with the `admin` scope, which the plans endpoint requires for writes.

```powershell
$env:LIFT_TOKEN = "lift_pat_..."
pnpm eval
pnpm eval --only next-postgres-tecsmith-01
pnpm eval --concurrency 3
```

The API base defaults to `http://localhost:3000/api/v1`; set `LIFT_API_URL` to use another local Lift API. The runner submits one plan request per healthy case, passing the pinned commit SHA as the GitHub ref, and checks that the API returns that same SHA. Each request creates a plan draft in the Lift API. The runner does not apply plans or deploy services.

It scores service count, service type, port, start command, database types, and recall of required variable keys. Each run is written to `evals/results/` with variable values omitted. Cases with a non-null `breakage` are skipped. This runner does not yet measure deployment success, autofix, or prompt-injection resistance.

## Case format

Each case in `repos.json` has a stable `id`, public `repo`, pinned commit `ref`, stack label, expected `golden` plan, and `breakage` metadata (`null` for healthy cases). The expected values should be checked against the pinned repo's manifests, runtime configuration, and documentation.
