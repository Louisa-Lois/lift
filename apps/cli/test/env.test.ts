import fs from "node:fs";
import path from "node:path";
import * as fx from "@lift/shared/fixtures";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/program";
import { cleanDir, createTempDir } from "./helpers";

describe("lift env", () => {
  it("lists environment variables masked by default", async () => {
    const configDir = createTempDir();
    try {
      const configFile = path.join(configDir, "config.json");
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          token: "lift_pat_test",
          user: fx.me,
          apiUrl: "http://localhost:3000",
        }),
      );

      const { exitCode, stdout, stderr } = await runCli(["env"], {
        configDir,
      });

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toMatch(/KEY/i);
      expect(stdout).toMatch(/VALUE/i);
    } finally {
      cleanDir(configDir);
    }
  });

  it("sets variables with lift env set KEY=VALUE", async () => {
    const configDir = createTempDir();
    try {
      const configFile = path.join(configDir, "config.json");
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          token: "lift_pat_test",
          user: fx.me,
          apiUrl: "http://localhost:3000",
        }),
      );

      const { exitCode, stdout } = await runCli(["env", "set", "FOO=bar", "BAZ=qux"], {
        configDir,
      });

      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/set foo, baz/i);
      expect(stdout).toMatch(/lift up/i);
    } finally {
      cleanDir(configDir);
    }
  });

  it("unsets variables with lift env unset KEY", async () => {
    const configDir = createTempDir();
    try {
      const configFile = path.join(configDir, "config.json");
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          token: "lift_pat_test",
          user: fx.me,
          apiUrl: "http://localhost:3000",
        }),
      );

      const { exitCode, stdout } = await runCli(["env", "unset", "FOO"], {
        configDir,
      });

      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/removed foo/i);
      expect(stdout).toMatch(/lift up/i);
    } finally {
      cleanDir(configDir);
    }
  });
});
