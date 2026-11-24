import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as fx from "@lift/shared/fixtures";
import { describe, expect, it } from "vitest";
import { saveProjectLink } from "../src/config";
import { runCli } from "../src/program";
import { cleanDir, createTempDir } from "./helpers";

describe("lifecycle commands", () => {
  it("initiates rollback with lift rollback", async () => {
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

      saveProjectLink(
        { projectId: fx.fixtureIds.project, serviceId: fx.fixtureIds.services.web },
        cwd,
      );

      const { exitCode, stdout } = await runCli(["rollback"], { configDir, cwd });

      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/rolling back/i);
    } finally {
      cleanDir(configDir);
      cleanDir(cwd);
    }
  });

  it("triggers redeployment with lift redeploy", async () => {
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

      saveProjectLink(
        { projectId: fx.fixtureIds.project, serviceId: fx.fixtureIds.services.web },
        cwd,
      );

      const { exitCode, stdout } = await runCli(["redeploy"], { configDir, cwd });

      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/redeploy initiated/i);
    } finally {
      cleanDir(configDir);
      cleanDir(cwd);
    }
  });

  it("restarts service container with lift restart", async () => {
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

      saveProjectLink(
        { projectId: fx.fixtureIds.project, serviceId: fx.fixtureIds.services.web },
        cwd,
      );

      const { exitCode, stdout } = await runCli(["restart"], { configDir, cwd });

      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/restarting service/i);
    } finally {
      cleanDir(configDir);
      cleanDir(cwd);
    }
  });

  it("complete everyday flow: login -> link -> up", async () => {
    const configDir = createTempDir();
    const cwd = createTempDir();
    try {
      execSync("git init && git remote add origin https://github.com/lift-demo/next-hello.git", {
        cwd,
      });

      // 1. login --token
      const token = `lift_pat_${"b".repeat(32)}`;
      const loginRes = await runCli(["login", "--token", token], {
        configDir,
        cwd,
      });
      expect(loginRes.exitCode).toBe(0);

      // 2. link
      const linkRes = await runCli(["link"], { configDir, cwd });
      expect(linkRes.exitCode).toBe(0);

      // 3. up
      const upRes = await runCli(["up"], { configDir, cwd });
      expect(upRes.exitCode).toBe(0);
      expect(upRes.stdout).toMatch(/live at/i);
    } finally {
      cleanDir(configDir);
      cleanDir(cwd);
    }
  });
});
