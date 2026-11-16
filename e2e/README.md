# e2e

The Playwright test of the demo script, run against staging. **Owner:** WS5 CLI, quality & delivery. **Spec:** [docs/prd/05-quality-delivery.md](../docs/prd/05-quality-delivery.md).

QA-06 covers the manual path (sign in, deploy, variables, database, rollback) by Nov 23; QA-09 adds the editor in two browser contexts and the AI steps by Nov 28. Tests sign in by exchanging the `lift-demo` bot's personal token for a session (`POST /api/v1/auth/session`). Until then `pnpm demo:check` exits with a pointer to QA-06.
