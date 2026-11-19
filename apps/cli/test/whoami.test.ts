import fs from "node:fs";
import path from "node:path";
import { User } from "@lift/shared";
import * as fx from "@lift/shared/fixtures";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/program";
import { cleanDir, createTempDir } from "./helpers";

describe("lift whoami", () => {
  it("prints current user details when signed in", async () => {
    const configDir = createTempDir();
    try {
      const configFile = path.join(configDir, "config.json");
      fs.writeFileSync(
        configFile,
        JSON.stringify({ token: "lift_pat_test", user: fx.me, apiUrl: "http://localhost:3000" }),
      );

      const { exitCode, stdout, stderr } = await runCli(["whoami"], { configDir });

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain(fx.me.name);
      expect(stdout).toContain(fx.me.login);
    } finally {
      cleanDir(configDir);
    }
  });

  it("outputs JSON matching User schema in --json mode", async () => {
    const configDir = createTempDir();
    try {
      const configFile = path.join(configDir, "config.json");
      fs.writeFileSync(
        configFile,
        JSON.stringify({ token: "lift_pat_test", user: fx.me, apiUrl: "http://localhost:3000" }),
      );

      const { exitCode, stdout, stderr } = await runCli(["whoami", "--json"], { configDir });

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const parsed = JSON.parse(stdout.trim());
      const validated = User.safeParse(parsed);
      expect(validated.success).toBe(true);
      expect(parsed.id).toBe(fx.me.id);
      expect(parsed.login).toBe(fx.me.login);
    } finally {
      cleanDir(configDir);
    }
  });

  it("fails with exit code 3 and helpful message when not signed in", async () => {
    const configDir = createTempDir();
    try {
      const { exitCode, stderr, stdout } = await runCli(["whoami"], { configDir });

      expect(exitCode).toBe(3);
      expect(stdout).toBe("");
      expect(stderr).toContain("Not signed in");
      expect(stderr).toContain("lift login");
    } finally {
      cleanDir(configDir);
    }
  });
});
