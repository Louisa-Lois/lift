import fs from "node:fs";
import path from "node:path";
import * as fx from "@lift/shared/fixtures";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/program";
import { cleanDir, createTempDir } from "./helpers";

describe("lift link", () => {
  it("links directory and writes .lift/project.json and updates .gitignore", async () => {
    const configDir = createTempDir();
    const cwd = createTempDir();
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

      const { exitCode, stdout, stderr } = await runCli(["link"], {
        configDir,
        cwd,
      });

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toMatch(/linked to project/i);

      const linkFile = path.join(cwd, ".lift", "project.json");
      expect(fs.existsSync(linkFile)).toBe(true);

      const content = JSON.parse(fs.readFileSync(linkFile, "utf8"));
      expect(content.projectId).toBe(fx.fixtureIds.project);
      expect(content.serviceId).toBe(fx.fixtureIds.services.web);

      const gitignore = path.join(cwd, ".gitignore");
      expect(fs.existsSync(gitignore)).toBe(true);
      expect(fs.readFileSync(gitignore, "utf8")).toContain(".lift/");
    } finally {
      cleanDir(configDir);
      cleanDir(cwd);
    }
  });

  it("outputs JSON with project and service IDs in --json mode", async () => {
    const configDir = createTempDir();
    const cwd = createTempDir();
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

      const { exitCode, stdout } = await runCli(["link", "--json"], {
        configDir,
        cwd,
      });

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout.trim());
      expect(parsed.projectId).toBe(fx.fixtureIds.project);
      expect(parsed.serviceId).toBe(fx.fixtureIds.services.web);
    } finally {
      cleanDir(configDir);
      cleanDir(cwd);
    }
  });

  it("fails with exit code 3 when not signed in", async () => {
    const configDir = createTempDir();
    const cwd = createTempDir();
    try {
      const { exitCode, stderr } = await runCli(["link"], { configDir, cwd });
      expect(exitCode).toBe(3);
      expect(stderr).toContain("Not signed in");
    } finally {
      cleanDir(configDir);
      cleanDir(cwd);
    }
  });
});
