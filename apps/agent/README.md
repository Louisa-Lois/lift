# @lift/agent

The AI service: onboarding planner, autofix, ops chat and watcher. Internal only: the API calls it with `AGENT_SERVICE_TOKEN`, and it acts only by calling the public API as the user. **Owner:** WS3 AI agent. **Spec:** [docs/prd/03-ai-agent.md](../../docs/prd/03-ai-agent.md).

**Today:** a Fastify server on port 4100 with `GET /health` and a test.
**Next:** AI-00 (plan, action, diagnosis and chat-stream schemas in `packages/shared`) by Nov 18, then AI-01 (internal routes, Anthropic client, prompt caching, token budget) and AI-02 (read tools) by Nov 19.

| Command | What it does |
| --- | --- |
| `pnpm --filter agent dev` | Start on port 4100 with the root `.env` |
| `pnpm --filter agent test` | Vitest; model calls use recorded responses, never the live API |
| `pnpm --filter agent build` | Bundle to `dist/index.js` |

Layout to grow into, from the PRD: `src/llm.ts`, `src/tools/`, `src/planner/`, `src/autofix/`, `src/chat/`, `src/guardrails/`, and `src/prompts/` (versioned `.md` prompts).
