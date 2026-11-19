import fs from "node:fs";
import path from "node:path";
import { User } from "@lift/shared";
import * as fx from "@lift/shared/fixtures";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/program";
import { cleanDir, createTempDir } from "./helpers";

describe("lift login", () => {
  it("saves the token with mode 600 and prints confirmation", async () => {
    const configDir = createTempDir();
    try {
      const token = `lift_pat_${"a".repeat(32)}`;
      const { exitCode, stdout, stderr } = await runCli(["login", "--token", token], {
        configDir,
      });

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain(fx.me.login);
      expect(stdout).not.toContain(token); // Never print the token!

      const configFile = path.join(configDir, "config.json");
      expect(fs.existsSync(configFile)).toBe(true);

      const content = JSON.parse(fs.readFileSync(configFile, "utf8"));
      expect(content.token).toBe(token);
      expect(content.user.login).toBe(fx.me.login);

      // Check file mode (on non-Windows or POSIX bitmask, 0o600)
      const stats = fs.statSync(configFile);
      // On Windows stats.mode might differ in bitmask, but verify permissions flag
      if (process.platform !== "win32") {
        expect(stats.mode & 0o777).toBe(0o600);
      }
    } finally {
      cleanDir(configDir);
    }
  });

  it("outputs valid User JSON in --json mode without color or token", async () => {
    const configDir = createTempDir();
    try {
      const token = `lift_pat_${"a".repeat(32)}`;
      const { exitCode, stdout, stderr } = await runCli(["login", "--token", token, "--json"], {
        configDir,
      });

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).not.toContain(token);

      const parsed = JSON.parse(stdout.trim());
      const validated = User.safeParse(parsed);
      expect(validated.success).toBe(true);
      expect(parsed.login).toBe(fx.me.login);
    } finally {
      cleanDir(configDir);
    }
  });

  it("fails with exit code 2 when --token flag is missing", async () => {
    const configDir = createTempDir();
    try {
      const { exitCode, stderr } = await runCli(["login"], { configDir });
      expect(exitCode).toBe(2);
      expect(stderr).toContain("lift login --token");
    } finally {
      cleanDir(configDir);
    }
  });

  it("fails with exit code 3 when token is rejected by the API", async () => {
    const configDir = createTempDir();
    try {
      const { exitCode, stderr } = await runCli(["login", "--token", "invalid_token"], {
        configDir,
      });
      expect(exitCode).toBe(3);
      expect(stderr).toContain("lift login");
    } finally {
      cleanDir(configDir);
    }
  });
});
