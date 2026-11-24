import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { API_BASE_PATH, newId } from "@lift/shared";
import * as fx from "@lift/shared/fixtures";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/program";
import { cleanDir, createTempDir } from "./helpers";
import { DEFAULT_MOCK_API, server } from "./mocks/server";

const api = (p: string) => `${DEFAULT_MOCK_API}${API_BASE_PATH}${p}`;

describe("lift link", () => {
  it("links directory and writes .lift/project.json and updates .gitignore when git remote matches service", async () => {
    const configDir = createTempDir();
    const cwd = createTempDir();
    try {
      execSync("git init && git remote add origin https://github.com/lift-demo/next-hello.git", {
        cwd,
      });
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
      execSync("git init && git remote add origin https://github.com/lift-demo/next-hello.git", {
        cwd,
      });
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

  it("fails with usage error suggesting --project when multiple projects exist", async () => {
    const configDir = createTempDir();
    const cwd = createTempDir();

    server.use(
      http.get(api("/projects"), () => {
        return HttpResponse.json(
          fx.page([
            fx.projectListItem,
            {
              ...fx.projectListItem,
              id: newId("prj"),
              name: "Other Project",
              slug: "other",
            },
          ]),
        );
      }),
    );

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

      const { exitCode, stderr } = await runCli(["link"], {
        configDir,
        cwd,
      });

      expect(exitCode).toBe(2);
      expect(stderr).toMatch(/found 2 projects/i);
      expect(stderr).toMatch(/--project/i);
    } finally {
      cleanDir(configDir);
      cleanDir(cwd);
    }
  });

  it("fails with usage error suggesting --service when project has multiple services and no remote matches", async () => {
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

      const { exitCode, stderr } = await runCli(["link"], {
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

  it("links explicitly specified --service even without matching git remote", async () => {
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

      const { exitCode, stdout } = await runCli(["link", "--service", "web"], {
        configDir,
        cwd,
      });

      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/linked to project/i);
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
