import fs from "node:fs";
import path from "node:path";
import { Service } from "@lift/shared";
import * as fx from "@lift/shared/fixtures";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/program";
import { cleanDir, createTempDir } from "./helpers";

describe("lift status", () => {
  it("prints a table of services when signed in", async () => {
    const configDir = createTempDir();
    try {
      const configFile = path.join(configDir, "config.json");
      fs.writeFileSync(
        configFile,
        JSON.stringify({ token: "lift_pat_test", user: fx.me, apiUrl: "http://localhost:3000" }),
      );

      const { exitCode, stdout, stderr } = await runCli(["status"], { configDir });

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toMatch(/NAME/i);
      expect(stdout).toMatch(/STATUS/i);
      expect(stdout).toMatch(/URL/i);
      expect(stdout).toContain(fx.services.web.name);
      expect(stdout).toContain(fx.services.api.name);
    } finally {
      cleanDir(configDir);
    }
  });

  it("outputs JSON matching Service schemas in --json mode", async () => {
    const configDir = createTempDir();
    try {
      const configFile = path.join(configDir, "config.json");
      fs.writeFileSync(
        configFile,
        JSON.stringify({ token: "lift_pat_test", user: fx.me, apiUrl: "http://localhost:3000" }),
      );

      const { exitCode, stdout, stderr } = await runCli(["status", "--json"], { configDir });

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const parsed = JSON.parse(stdout.trim());
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);

      for (const item of parsed) {
        const validated = Service.safeParse(item);
        expect(validated.success).toBe(true);
      }
    } finally {
      cleanDir(configDir);
    }
  });

  it("filters to a specific service with --service flag", async () => {
    const configDir = createTempDir();
    try {
      const configFile = path.join(configDir, "config.json");
      fs.writeFileSync(
        configFile,
        JSON.stringify({ token: "lift_pat_test", user: fx.me, apiUrl: "http://localhost:3000" }),
      );

      const { exitCode, stdout } = await runCli(["status", "--service", "web"], { configDir });

      expect(exitCode).toBe(0);
      expect(stdout).toContain(fx.services.web.name);
      expect(stdout).not.toContain(fx.services.api.name);
    } finally {
      cleanDir(configDir);
    }
  });

  it("fails with exit code 3 and helpful message when not signed in", async () => {
    const configDir = createTempDir();
    try {
      const { exitCode, stderr, stdout } = await runCli(["status"], { configDir });

      expect(exitCode).toBe(3);
      expect(stdout).toBe("");
      expect(stderr).toContain("Not signed in");
      expect(stderr).toContain("lift login");
    } finally {
      cleanDir(configDir);
    }
  });
});
