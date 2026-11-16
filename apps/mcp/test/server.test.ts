import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createLiftMcpServer, SERVER_INFO } from "../src/server";

describe("Lift MCP server", () => {
  it("completes the MCP handshake", async () => {
    const server = createLiftMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: "lift-test", version: "0.0.0" });
    await client.connect(clientTransport);

    expect(client.getServerVersion()).toMatchObject(SERVER_INFO);

    await client.close();
    await server.close();
  });
});
