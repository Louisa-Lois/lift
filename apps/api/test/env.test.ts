import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env";

describe("loadEnv", () => {
  it("falls back to development defaults", () => {
    const env = loadEnv({});
    expect(env).toMatchObject({ NODE_ENV: "development", API_PORT: 4000, HOST: "127.0.0.1" });
  });

  it("listens on every interface in production", () => {
    expect(loadEnv({ NODE_ENV: "production" }).HOST).toBe("0.0.0.0");
  });

  it("refuses to start on bad config", () => {
    expect(() => loadEnv({ API_PORT: "not-a-port" })).toThrow(/API_PORT/);
  });
});
