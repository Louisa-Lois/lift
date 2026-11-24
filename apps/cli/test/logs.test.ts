import fs from "node:fs";
import path from "node:path";
import * as fx from "@lift/shared/fixtures";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/program";
import { cleanDir, createTempDir } from "./helpers";

describe("lift logs", () => {
  it("displays deployment logs for specified deployment", async () => {
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

      const { exitCode, stdout, stderr } = await runCli(
        ["logs", "--deployment", fx.fixtureIds.deployments.webActive],
        { configDir },
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout.length).toBeGreaterThan(0);
    } finally {
      cleanDir(configDir);
    }
  });

  it("outputs array of log lines in --json mode", async () => {
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

      const { exitCode, stdout } = await runCli(
        ["logs", "--deployment", fx.fixtureIds.deployments.webActive, "--json"],
        { configDir },
      );

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout.trim());
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
    } finally {
      cleanDir(configDir);
    }
  });

  it("fails with exit code 3 when not signed in", async () => {
    const configDir = createTempDir();
    try {
      const { exitCode, stderr } = await runCli(
        ["logs", "--deployment", fx.fixtureIds.deployments.webActive],
        { configDir },
      );
      expect(exitCode).toBe(3);
      expect(stderr).toContain("Not signed in");
    } finally {
      cleanDir(configDir);
    }
  });
});
