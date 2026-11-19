# @lift/worker

Runs on the worker VM: consumes the build, deploy and ops queues, builds images with Railpack on BuildKit, runs app containers with limits behind Traefik, ships logs and metrics, provisions databases and reconciles what should be running. **Owner:** WS4 Infrastructure & worker. **Spec:** [docs/prd/04-infrastructure.md](../../docs/prd/04-infrastructure.md).

**Today:** a long-running process that validates its environment and names the queues it will consume.
**Next:** INF-04 (build job) and INF-05 (deploy job), developed against the local stack (`pnpm stack:up`: BuildKit, a Traefik for `*.apps.localhost` and `lift-probe`; see `infra/README.md`) with test jobs and a fake of the internal API.

| Command | What it does |
| --- | --- |
| `pnpm --filter worker dev` | Start with the root `.env`, restarting on changes |
| `pnpm --filter worker test` | Vitest; the Docker integration test arrives with INF-04 |
| `pnpm --filter worker build` | Bundle to `dist/index.js` |
| `pnpm --filter @lift/worker clean` | Remove the app containers and project networks the worker started on this machine (run it before `pnpm stack:down`) |
