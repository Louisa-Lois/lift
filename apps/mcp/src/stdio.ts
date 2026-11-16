import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createLiftMcpServer } from "./server";

// stdout carries the MCP protocol, so anything human-readable goes to stderr.
const server = createLiftMcpServer();
await server.connect(new StdioServerTransport());
console.error("Lift MCP server running on stdio");
