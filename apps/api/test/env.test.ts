import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isAllowedLogin, loadEnv } from "../src/env";

const PRODUCTION = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://lift:secret@postgres:5432/lift",
  REDIS_URL: "redis://:secret@redis:6379",
  PUBLIC_URL: "https://app.example.test",
  APPS_DOMAIN: "apps.example.test",
  AGENT_URL: "http://agent:4100",
  SESSION_SECRET: "s".repeat(64),
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  WORKER_TOKEN: "w".repeat(64),
  AGENT_SERVICE_TOKEN: `lift_svc_${"a".repeat(32)}`,
  COLLAB_SECRET: "c".repeat(64),
  GITHUB_CLIENT_ID: "Ov23liexample",
  GITHUB_CLIENT_SECRET: "x".repeat(40),
  ALLOWED_GITHUB_LOGINS: "vitalik-hakim,Louisa-Lois",
};

describe("loadEnv", () => {
  it("falls back to the local stack in development", () => {
    const env = loadEnv({});
    expect(env).toMatchObject({
      NODE_ENV: "development",
      API_PORT: 4000,
      HOST: "127.0.0.1",
      DATABASE_URL: "postgres://lift:lift@localhost:5432/lift",
      REDIS_URL: "redis://localhost:6379",
      PUBLIC_URL: "http://localhost:3000",
      APPS_DOMAIN: "apps.localhost",
    });
    expect(env.SESSION_SECRET).toBeUndefined();
  });

  it("treats an empty value in .env as unset", () => {
    expect(loadEnv({ GITHUB_CLIENT_ID: "", DATABASE_URL: "" })).toMatchObject({
      GITHUB_CLIENT_ID: undefined,
      DATABASE_URL: "postgres://lift:lift@localhost:5432/lift",
    });
  });

  it("starts in production when everything is set, listening on every interface", () => {
    expect(loadEnv(PRODUCTION).HOST).toBe("0.0.0.0");
  });

  it("names every missing variable in production instead of falling back", () => {
    const { DATABASE_URL: _, GITHUB_CLIENT_SECRET: __, ...rest } = PRODUCTION;
    expect(() => loadEnv(rest)).toThrow(/production needs DATABASE_URL, GITHUB_CLIENT_SECRET$/);
  });

  it("refuses an ENCRYPTION_KEY that isn't exactly 32 bytes", () => {
    const short = randomBytes(31).toString("base64");
    expect(() => loadEnv({ ...PRODUCTION, ENCRYPTION_KEY: short })).toThrow(/ENCRYPTION_KEY/);
  });

  it("refuses an AGENT_SERVICE_TOKEN in the wrong format", () => {
    const hex = `lift_svc_${"a".repeat(48)}`;
    expect(() => loadEnv({ ...PRODUCTION, AGENT_SERVICE_TOKEN: hex })).toThrow(
      /AGENT_SERVICE_TOKEN/,
    );
  });

  it("refuses short secrets and bad ports", () => {
    expect(() => loadEnv({ ...PRODUCTION, WORKER_TOKEN: "short" })).toThrow(/WORKER_TOKEN/);
    expect(() => loadEnv({ API_PORT: "not-a-port" })).toThrow(/API_PORT/);
  });

  it("reads ALLOWED_GITHUB_LOGINS trimmed and lowercased", () => {
    const env = loadEnv({ ALLOWED_GITHUB_LOGINS: " Vitalik-Hakim , louisa-lois ," });
    expect(env.ALLOWED_GITHUB_LOGINS).toEqual(["vitalik-hakim", "louisa-lois"]);
    expect(isAllowedLogin(env, "LOUISA-LOIS")).toBe(true);
    expect(isAllowedLogin(env, "someone-else")).toBe(false);
  });

  it("lets anyone sign in when the list is empty, which only development allows", () => {
    expect(isAllowedLogin(loadEnv({}), "anyone")).toBe(true);
    expect(() => loadEnv({ ...PRODUCTION, ALLOWED_GITHUB_LOGINS: " , " })).toThrow(
      /ALLOWED_GITHUB_LOGINS lists no logins/,
    );
    const { ALLOWED_GITHUB_LOGINS: _, ...withoutList } = PRODUCTION;
    expect(() => loadEnv(withoutList)).toThrow(/production needs ALLOWED_GITHUB_LOGINS$/);
  });

  it("refuses something that isn't a GitHub login", () => {
    expect(() => loadEnv({ ALLOWED_GITHUB_LOGINS: "ok-user,not a login!" })).toThrow(
      /ALLOWED_GITHUB_LOGINS/,
    );
  });
});
