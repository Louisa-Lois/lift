# @lift/worker

Runs on the worker VM: consumes the build, deploy and ops queues, builds images with Railpack on BuildKit, runs app containers with limits behind Traefik, ships logs and metrics, provisions databases and reconciles what should be running. **Owner:** WS4 Infrastructure & worker. **Spec:** [docs/prd/04-infrastructure.md](../../docs/prd/04-infrastructure.md).

**Today:** the build job (INF-04) and the deploy job (INF-05).
- **Build** (`lift-build`, one at a time by default, `BUILD_CONCURRENCY`):
  - It reports `building`, fetches the build context from the API, clones exactly the commit, builds `lift/{serviceId}:{deploymentId}` with Railpack through BuildKit, checks Docker has the image, and reports `deploying`.
  - On failure it reports `failed` with `clone_failed`, `build_failed`, or `build_timeout` after 15 minutes.
  - The clone token travels only in `GIT_CONFIG_*` environment variables: never in argv, a URL, a file or a log. Tools run with `PATH` and `HOME` only, never the worker's own secrets.
  - The service's variables reach Railpack by name only (`--env KEY`), with each value in Railpack's environment, which it reads for a bare name. Keys the build tools read themselves (PATH, HOME, `DOCKER_*`, `BUILDKIT_*`, `LD_*`, proxies) stay out of the build, with a line in its log; the app still gets them when it runs.
  - Dockerfile builds fail with a clear message until INF-13.
- **Deploy** (`lift-deploy`, 4 at a time, one per service):
  - It fetches the runtime environment and creates `lift-{slug}-{last 6 of the deployment ID}` with Traefik labels and hard limits (CPU, memory with no extra swap, 256 processes, no privilege escalation, no raw sockets). The container joins `lift-edge` and the project's network under its slug.
  - It polls the health-check path every 2 s for up to 120 s, from `lift-probe` (`docker exec … curl`), so the worker never joins the apps' network.
  - When healthy, it switches the container's restart policy to `unless-stopped` and reports `active`. It keeps the previous container serving for 10 s, then stops it gracefully (SIGTERM, up to 10 s) and removes it. Until it's healthy, a container has no restart policy, so a crash keeps its real exit code.
  - An app that exits fails as `crashed`, with a plain reason: out of memory (Docker's OOM flag), exit 127 (a command or library missing from the image), exit 0 (the start command finished instead of serving). One that never answers fails as `healthcheck_failed`. Either way the app's last 100 lines go into the deployment's log, and the previous deployment keeps serving.
  - No request fails during a swap. Every deployment of a service joins one Traefik service (`svc-{serviceId}`), so old and new share a load balancer. Each router retries a request that couldn't connect, and Traefik's 2 s dial timeout means a request that reaches a container just removed fails over in about 2 s. `test:docker` polls through Traefik for a whole redeploy and expects only 200s.
  - The worker talks to Docker through its Engine API on the unix socket (`DOCKER_HOST` if set, else `/var/run/docker.sock`, else Docker Desktop's), so environment values travel in JSON, never in argv.
- **Ops** (`lift-ops`): `remove_service` removes a deleted service's containers. The other ops fail loudly until INF-10.
- **Databases (INF-10):** `provision_db` fetches the credentials from `provision-context`, then, as lift-pg's superuser (`LIFT_PG_URL`), creates a role and a database both named after the database ID. The role gets a SCRAM verifier, never the password, and PUBLIC loses CONNECT on its database, on `postgres` and on `template1`, so one project's credentials can't reach another's data. lift-pg then joins the project's network, and the worker reports `ready` at `lift-pg:5432`. `deprovision_db` drops both and takes lift-pg off the network. On the VM, `infra/compose/lift-pg/pg_hba.conf` also lets the superuser in only from lift-system, and each role only into its own database.
- **Stop and restart:** a canceled deployment's `stop` aborts its build through a registry the build and ops workers share (git or Railpack gets SIGTERM, then SIGKILL after 10 s; the build directory is still deleted), or else stops and removes its containers. `restart` restarts the deployment's container and waits for it to run again.
- **Logs:** every line goes to `logs:dep:{deploymentId}` before the report that ends the stage, scrubbed of the clone token and cut at 8 KB. Variable values of 8 characters or more are scrubbed too, in build lines and in a crashing app's last lines, except plain words like `production`.
- **409s:** a 409 from the API means the deployment moved on (canceled, or failed by the backstop), so the job stops quietly and removes anything it created.

**Next:** INF-11 (hardening) before anyone outside the team can deploy; then INF-09 (runtime logs and metrics), INF-10 (databases) and INF-12 (reconciliation).

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
| `pnpm --filter @lift/worker test:docker` | Real builds and deploys on the local stack: Railpack, BuildKit, Docker, `lift-probe` and the dev Traefik. Set `LIFT_APPS_PORT` if Traefik isn't on port 80. The first run takes a few minutes while images download |
| `pnpm --filter worker build` | Bundle to `dist/index.js` |
| `pnpm --filter @lift/worker clean` | Remove the app containers and project networks the worker started on this machine (run it before `pnpm stack:down`) |
