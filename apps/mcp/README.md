# @lift/mcp

The MCP server that lets coding agents (Claude Code, Cursor, Codex) deploy and debug through Lift. **Owner:** WS3 AI agent. **Spec:** "MCP server" in [docs/prd/03-ai-agent.md](../../docs/prd/03-ai-agent.md).

**Today:** an MCP server named `lift` over stdio, with no tools yet; a test runs the full MCP handshake in memory.
**Next:** AI-09, the tools (`list_projects`, `create_project_from_repo`, `deploy`, `get_deployment_status`, `get_logs`, `set_env`, `add_database`, `rollback`), by Nov 28.

| Command | What it does |
| --- | --- |
| `pnpm --filter mcp build` | Bundle to `dist/stdio.js`, the file MCP clients launch |
| `pnpm --filter mcp test` | Vitest with an in-memory MCP client |

Try it from Claude Code after a build: `claude mcp add lift --env LIFT_TOKEN=lift_pat_… -- node /path/to/lift/apps/mcp/dist/stdio.js`. On stdio, stdout carries the protocol, so log to stderr only.
