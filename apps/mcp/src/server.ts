import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const SERVER_INFO = { name: "lift", version: "0.0.0" } as const;

/**
 * The Lift MCP server. AI-09 registers the tools from docs/prd/03-ai-agent.md (list_projects,
 * create_project_from_repo, deploy, get_deployment_status, get_logs, set_env, add_database,
 * rollback), each one a call to the public Lift API with the user's token.
 */
export function createLiftMcpServer(): McpServer {
  return new McpServer(SERVER_INFO);
}
