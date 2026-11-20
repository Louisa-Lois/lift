import { createDb } from "@lift/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCollabServer } from "../src/server";

describe("collab server", () => {
  // The health check never touches the database, and postgres.js connects on the first query.
  const { db, close } = createDb("postgres://nobody@127.0.0.1:1/none");
  const server = createCollabServer(
    { HOST: "127.0.0.1", COLLAB_PORT: 0, COLLAB_SECRET: undefined },
    db,
  );
  let baseUrl = "";

  beforeAll(async () => {
    await server.listen();
    baseUrl = `http://127.0.0.1:${server.address.port}`;
  });
  afterAll(async () => {
    await server.destroy();
    await close();
  });

  it("answers its health check", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("answers the health check behind the /collab prefix", async () => {
    const response = await fetch(`${baseUrl}/collab/health`);
    expect(response.status).toBe(200);
  });

  it("refuses the internal routes when it has no COLLAB_SECRET", async () => {
    const response = await fetch(`${baseUrl}/internal/documents/text`, {
      method: "POST",
      headers: { authorization: "Bearer " },
      body: JSON.stringify({ names: ["x"] }),
    });
    expect(response.status).toBe(401);
  });
});
