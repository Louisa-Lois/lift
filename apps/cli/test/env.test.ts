import fs from "node:fs";
import path from "node:path";
import * as fx from "@lift/shared/fixtures";
import { describe, expect, it } from "vitest";
import { saveProjectLink } from "../src/config";
import { runCli } from "../src/program";
import { cleanDir, createTempDir } from "./helpers";

describe("lift env", () => {
  it("lists environment variables masked by default", async () => {
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

      const { exitCode, stdout, stderr } = await runCli(["env"], {
        configDir,
        cwd,
      });

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toMatch(/DATABASE_URL/i);
      expect(stdout).toMatch(/SESSION_SECRET/i);
    } finally {
      cleanDir(configDir);
      cleanDir(cwd);
    }
  });

  it("sets variables with lift env set KEY=VALUE", async () => {
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

      const { exitCode, stdout } = await runCli(["env", "set", "FOO=bar", "BAZ=qux"], {
        configDir,
        cwd,
      });

      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/set foo, baz/i);
      expect(stdout).toMatch(/lift up/i);
    } finally {
      cleanDir(configDir);
      cleanDir(cwd);
    }
  });

  it("unsets variables with lift env unset KEY", async () => {
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

      const { exitCode, stdout } = await runCli(["env", "unset", "FOO"], {
        configDir,
        cwd,
      });

      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/removed foo/i);
      expect(stdout).toMatch(/lift up/i);
    } finally {
      cleanDir(configDir);
      cleanDir(cwd);
    }
  });

  it("fails with usage error when multiple services exist without link or --service", async () => {
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

      const { exitCode, stderr } = await runCli(["env"], {
        configDir,
        cwd,
      });

      expect(exitCode).toBe(2);
      expect(stderr).toMatch(/has 2 services/i);
      expect(stderr).toMatch(/--service/i);
    } finally {
      cleanDir(configDir);
      cleanDir(cwd);
    }
  });
});
