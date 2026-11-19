import fs from "node:fs";
import path from "node:path";
import * as fx from "@lift/shared/fixtures";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/program";
import { cleanDir, createTempDir } from "./helpers";

describe("lift logout", () => {
  it("removes the token from the config file", async () => {
    const configDir = createTempDir();
    try {
      const configFile = path.join(configDir, "config.json");
      fs.writeFileSync(
        configFile,
        JSON.stringify({ token: "lift_pat_abc", user: fx.me, apiUrl: "http://localhost:3000" }),
      );

      const { exitCode, stdout, stderr } = await runCli(["logout"], { configDir });

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toMatch(/logged out/i);

      const content = JSON.parse(fs.readFileSync(configFile, "utf8"));
      expect(content.token).toBeUndefined();
      expect(content.user).toBeUndefined();
    } finally {
      cleanDir(configDir);
    }
  });

  it("outputs JSON in --json mode", async () => {
    const configDir = createTempDir();
    try {
      const { exitCode, stdout } = await runCli(["logout", "--json"], { configDir });
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout.trim());
      expect(parsed).toEqual({ status: "ok" });
    } finally {
      cleanDir(configDir);
    }
  });
});
