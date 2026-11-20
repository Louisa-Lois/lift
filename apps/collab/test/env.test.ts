import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env";

describe("the collab server's environment", () => {
  it("falls back to the local stack in development, with no secret", () => {
    const env = loadEnv({});
    expect(env).toMatchObject({
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      COLLAB_PORT: 4200,
      DATABASE_URL: "postgres://lift:lift@localhost:5432/lift",
    });
    expect(env.COLLAB_SECRET).toBeUndefined();
    expect(loadEnv({ COLLAB_SECRET: "" }).COLLAB_SECRET).toBeUndefined();
  });

  it("needs DATABASE_URL and COLLAB_SECRET in production", () => {
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(
      "production needs DATABASE_URL, COLLAB_SECRET",
    );
    const env = loadEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://lift:pw@postgres:5432/lift",
      COLLAB_SECRET: "s".repeat(32),
    });
    expect(env.HOST).toBe("0.0.0.0");
  });

  it("refuses a short secret", () => {
    expect(() => loadEnv({ COLLAB_SECRET: "short" })).toThrow("must be at least 32 characters");
  });
});
