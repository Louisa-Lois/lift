# @lift/cli

The `lift` command-line tool. **Owner:** WS5 CLI, quality & delivery. **Spec:** "The lift CLI" in [docs/prd/05-quality-delivery.md](../../docs/prd/05-quality-delivery.md).

**Today:** `lift --version` and `lift --help`, with tests.
**Next:** QA-03 (`login --token`, `whoami`, `status`, `--json`, exit codes) by Nov 19.

| Command | What it does |
| --- | --- |
| `pnpm --filter cli build` | Bundle to `dist/index.js` (executable) |
| `pnpm --filter cli test` | Vitest |
| `npm install -g ./apps/cli` | Put `lift` on your PATH after a build |
