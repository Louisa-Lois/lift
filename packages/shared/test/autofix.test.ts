import { describe, expect, it } from "vitest";
import {
  type AutofixChange,
  type AutofixFacts,
  allowedChange,
  describeChange,
  parseEnvExample,
} from "../src/autofix";

const facts: AutofixFacts = {
  service: { port: 3000, healthcheckPath: "/", memoryMb: 512 },
  variables: [
    { key: "STRIPE_SECRET_KEY", source: "user" },
    { key: "DATABASE_URL", source: "database" },
    { key: "RAILPACK_NODE_VERSION", source: "agent" },
  ],
  envExample: {
    GREETING: "hello",
    SESSION_SECRET: "change-me",
    SITE_NAME: "your-site",
    API_KEY: "abc",
  },
};
const setting = (
  name: "port" | "healthcheckPath" | "memoryMb" | "startCommand",
  value: string,
): AutofixChange => ({
  kind: "setting",
  setting: name,
  value,
});
const variable = (key: string, value: string): AutofixChange => ({ kind: "variable", key, value });

describe("what autofix may change by itself", () => {
  it.each([
    ["the port", setting("port", "8080")],
    ["the health check path", setting("healthcheckPath", "/health")],
    ["more memory, up to 1 GB", setting("memoryMb", "1024")],
    ["the Node version, to a supported one", variable("RAILPACK_NODE_VERSION", "22")],
    ["the Python version", variable("RAILPACK_PYTHON_VERSION", "3.12")],
    ["an npm switch", variable("NPM_CONFIG_LEGACY_PEER_DEPS", "true")],
    ["a safe default from .env.example", variable("GREETING", "hello")],
  ])("allows %s", (_name, change) => {
    expect(allowedChange(change, facts)).toEqual({ ok: true });
  });

  it.each([
    ["a port below 1024", setting("port", "80"), "between 1024 and 65535"],
    ["the port it already has", setting("port", "3000"), "already"],
    ["less memory", setting("memoryMb", "256"), "only raises"],
    ["more than 1 GB", setting("memoryMb", "2048"), "1024 MiB"],
    ["a start command", setting("startCommand", "node evil.js"), "proposed"],
    ["Node 18", variable("RAILPACK_NODE_VERSION", "18"), "isn't one"],
    ["a variable the user set", variable("STRIPE_SECRET_KEY", "sk_live_x"), "never overwrites"],
    ["a database's variable", variable("DATABASE_URL", "postgres://evil/db"), "never overwrites"],
    ["PORT", variable("PORT", "8080"), "Lift sets PORT"],
    ["a secret-looking key, even in .env.example", variable("API_KEY", "abc"), "secret"],
    ["a placeholder", variable("SITE_NAME", "your-site"), "placeholder"],
    ["a value that isn't the repo's", variable("GREETING", "hi"), "example value"],
    ["a key the repo doesn't have", variable("ADMIN_MODE", "true"), "example value"],
    [
      "an npm switch set to anything else",
      variable("NPM_CONFIG_REGISTRY", "https://evil"),
      "true or false",
    ],
  ])("refuses %s", (_name, change, reason) => {
    const verdict = allowedChange(change, facts);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? "" : verdict.reason).toContain(reason);
  });
});

describe("reading .env.example", () => {
  it("takes KEY=value pairs, without comments, quotes or export", () => {
    expect(
      parseEnvExample(
        [
          "# A comment",
          "GREETING=hello",
          "export NODE_ENV=production",
          'QUOTED="two words"',
          "SINGLE='x'",
          "TRAILING=value # a note",
          "EMPTY=",
          "lower=ignored",
          "not a pair",
        ].join("\n"),
      ),
    ).toEqual({
      GREETING: "hello",
      NODE_ENV: "production",
      QUOTED: "two words",
      SINGLE: "x",
      TRAILING: "value",
      EMPTY: "",
    });
  });
});

describe("describing a change", () => {
  it("shows a variable's value only once Lift applied it", () => {
    expect(describeChange(variable("GREETING", "hello"), true)).toBe("Set GREETING to hello");
    expect(describeChange(variable("API_KEY", "abc"), false)).toBe("Set API_KEY");
    expect(describeChange(setting("port", "8080"), true)).toBe("Set the port to 8080");
    expect(describeChange(setting("startCommand", "node app.js"), false)).toBe(
      "Change the start command to node app.js",
    );
  });
});
