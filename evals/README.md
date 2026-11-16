# evals

The 30-repo evaluation of the planner and autofix. **Owner:** WS3 AI agent. **Spec:** "Evaluation harness" in [docs/prd/03-ai-agent.md](../docs/prd/03-ai-agent.md).

AI-05 adds `repos.json` (20 healthy repos and 10 broken variants, each pinned to a commit), `golden/` (the expected plan per repo) and `run.ts` behind `pnpm eval [--only id] [--concurrency 3]`. Until then `pnpm eval` exits with a pointer to AI-05.
