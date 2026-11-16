import { API_BASE_PATH } from "@lift/shared";
import { afterAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server";

describe(`GET ${API_BASE_PATH}/health`, () => {
  const app = buildServer({ LOG_LEVEL: "silent" });
  afterAll(() => app.close());

  it("answers ok", async () => {
    const response = await app.inject({ method: "GET", url: `${API_BASE_PATH}/health` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("returns 404 for unknown routes", async () => {
    const response = await app.inject({ method: "GET", url: `${API_BASE_PATH}/nope` });
    expect(response.statusCode).toBe(404);
  });
});
