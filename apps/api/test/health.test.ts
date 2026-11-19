import { API_BASE_PATH, Problem } from "@lift/shared";
import { afterAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server";
import { testEnv } from "./helpers/env";

// Needs the Postgres and Redis from `pnpm stack:up`.
describe(`GET ${API_BASE_PATH}/health`, () => {
  it("answers ok when Postgres and Redis answer", async () => {
    const app = buildServer(testEnv());
    try {
      const response = await app.inject({ method: "GET", url: `${API_BASE_PATH}/health` });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "ok" });
    } finally {
      await app.close();
    }
  });

  it.each([
    ["Redis", { REDIS_URL: "redis://127.0.0.1:1" }],
    ["Postgres", { DATABASE_URL: "postgres://lift:lift@127.0.0.1:1/lift" }],
  ])("answers 503 within 2 s when %s is down", async (name, overrides) => {
    const app = buildServer(testEnv(overrides));
    try {
      const started = Date.now();
      const response = await app.inject({ method: "GET", url: `${API_BASE_PATH}/health` });
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(response.statusCode).toBe(503);
      const body = Problem.parse(response.json());
      expect(body.code).toBe("upstream_unavailable");
      expect(body.detail).toBe(`${name} didn't answer.`);
    } finally {
      await app.close();
    }
  });
});

describe("the OpenAPI document", () => {
  const app = buildServer(testEnv());
  afterAll(() => app.close());

  it("is generated from the route schemas and lists only public routes", async () => {
    const response = await app.inject({ method: "GET", url: `${API_BASE_PATH}/openapi.json` });
    expect(response.statusCode).toBe(200);
    const document = response.json();
    expect(document.openapi).toMatch(/^3\.1/);
    expect(Object.keys(document.paths)).toContain(`${API_BASE_PATH}/health`);
    expect(Object.keys(document.paths)).not.toContain(`${API_BASE_PATH}/openapi.json`);
    expect(Object.keys(document.paths).some((path) => path.startsWith("/internal"))).toBe(false);
    expect(document.paths[`${API_BASE_PATH}/health`].get.responses["200"]).toBeDefined();
  });
});
