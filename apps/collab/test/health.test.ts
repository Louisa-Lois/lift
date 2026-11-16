import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCollabServer } from "../src/server";

describe("collab server", () => {
  const server = createCollabServer({ HOST: "127.0.0.1", COLLAB_PORT: 0 });
  let baseUrl = "";

  beforeAll(async () => {
    await server.listen();
    baseUrl = `http://127.0.0.1:${server.address.port}`;
  });
  afterAll(() => server.destroy());

  it("answers its health check", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("answers the health check behind the /collab prefix", async () => {
    const response = await fetch(`${baseUrl}/collab/health`);
    expect(response.status).toBe(200);
  });
});
