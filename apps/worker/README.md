# @lift/worker

Runs on the worker VM: consumes the build, deploy and ops queues, builds images with Railpack on BuildKit, runs app containers with limits behind Traefik, ships logs and metrics, provisions databases and reconciles what should be running. **Owner:** WS4 Infrastructure & worker. **Spec:** [docs/prd/04-infrastructure.md](../../docs/prd/04-infrastructure.md).

**Today:** the build job (INF-04).
- It consumes `lift-build`: one build at a time (`BUILD_CONCURRENCY`).
- For each job it reports `building`, fetches the build context from the API, clones exactly the commit, builds `lift/{serviceId}:{deploymentId}` with Railpack through BuildKit, checks Docker has the image, and reports `deploying` (or `failed` with `clone_failed`, `build_failed` or `build_timeout` after 15 minutes).
- Every line goes to `logs:dep:{deploymentId}` in Redis before the report that ends the build. Each line is scrubbed of the clone token and cut at 8 KB.
- The clone token travels only in `GIT_CONFIG_*` environment variables: never in argv, a URL, a file or a log. Tools run with `PATH` and `HOME` only, never the worker's own secrets.
- A 409 from the API means the deployment moved on (canceled, or failed by the backstop): the job stops quietly.
- Dockerfile builds fail with a clear message until INF-13.

**Next:** INF-05 (deploy job), then INF-11 (hardening) before anyone outside the team can deploy.

**Tools the build job runs.** The worker image has them; on your Mac, install them once. The worker checks for them at startup: in production a missing tool stops it, in development it only warns.
- git, which macOS has.
- The Docker CLI, which Docker Desktop has. Railpack runs `docker load` to hand over the image; without the CLI it hangs instead of failing.
- Railpack v0.43.0, the version the worker image pins:
  ```bash
  curl -fsSLO https://github.com/railwayapp/railpack/releases/download/v0.43.0/railpack-v0.43.0-arm64-apple-darwin.tar.gz
  echo "385026934127726fd0f9b5a1431c5ae441062ea9958a5f9dbb0e98a29142d6de  railpack-v0.43.0-arm64-apple-darwin.tar.gz" | shasum -a 256 -c -
  tar -xzf railpack-v0.43.0-arm64-apple-darwin.tar.gz railpack && sudo mv railpack /usr/local/bin/
  railpack --version
  ```

| Command | What it does |
| --- | --- |
| `pnpm --filter worker dev` | Start with the root `.env`, restarting on changes |
| `pnpm --filter @lift/worker test` | Vitest, with Redis from `pnpm stack:up` |
| `pnpm --filter @lift/worker test:docker` | A real build: git, Railpack, the local BuildKit and Docker (a few minutes the first time, while Railpack pulls its images) |
| `pnpm --filter worker build` | Bundle to `dist/index.js` |
| `pnpm --filter @lift/worker clean` | Remove the app containers and project networks the worker started on this machine (run it before `pnpm stack:down`) |
