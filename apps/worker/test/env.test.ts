import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env";

describe("the worker's environment", () => {
  it("falls back to the local stack in development", () => {
    const env = loadEnv({});
    expect(env).toMatchObject({
      CONTROL_API_URL: "http://localhost:4000",
      REDIS_URL: "redis://localhost:6379",
      APPS_DOMAIN: "apps.localhost",
      BUILDKIT_HOST: "tcp://localhost:1234",
      BUILD_CONCURRENCY: 1,
    });
    expect(env.WORKER_TOKEN).toBeUndefined();
    expect(env.BUILD_DIR).toMatch(/lift-builds$/);
  });

  it("needs WORKER_TOKEN in production, and builds in /var/lib/lift/builds there", () => {
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(/WORKER_TOKEN/);
    const env = loadEnv({ NODE_ENV: "production", WORKER_TOKEN: "w".repeat(32) });
    expect(env.BUILD_DIR).toBe("/var/lib/lift/builds");
  });

  it("refuses a short token", () => {
    expect(() => loadEnv({ WORKER_TOKEN: "short" })).toThrow(/at least 32 characters/);
  });
});
