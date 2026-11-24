import fs from "node:fs";
import path from "node:path";
import { API_BASE_PATH } from "@lift/shared";
import * as fx from "@lift/shared/fixtures";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/program";
import { cleanDir, createTempDir } from "./helpers";
import { DEFAULT_MOCK_API, server } from "./mocks/server";

const api = (p: string) => `${DEFAULT_MOCK_API}${API_BASE_PATH}${p}`;

describe("lift up", () => {
  it("deploys linked service and prints live URL", async () => {
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

      // Link project
      const linkDir = path.join(cwd, ".lift");
      fs.mkdirSync(linkDir, { recursive: true });
      fs.writeFileSync(
        path.join(linkDir, "project.json"),
        JSON.stringify({
          projectId: fx.fixtureIds.project,
          serviceId: fx.fixtureIds.services.web,
        }),
      );

      const { exitCode, stdout, stderr } = await runCli(["up"], {
        configDir,
        cwd,
      });

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toMatch(/queued deployment/i);
      expect(stdout).toMatch(/live at/i);
    } finally {
      cleanDir(configDir);
      cleanDir(cwd);
    }
  });

  it("outputs deployment detail in --json mode", async () => {
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

      const linkDir = path.join(cwd, ".lift");
      fs.mkdirSync(linkDir, { recursive: true });
      fs.writeFileSync(
        path.join(linkDir, "project.json"),
        JSON.stringify({
          projectId: fx.fixtureIds.project,
          serviceId: fx.fixtureIds.services.web,
        }),
      );

      const { exitCode, stdout } = await runCli(["up", "--json"], {
        configDir,
        cwd,
      });

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout.trim());
      expect(parsed.id).toBeDefined();
      expect(parsed.status).toBe("active");
    } finally {
      cleanDir(configDir);
      cleanDir(cwd);
    }
  });

  it("fails with exit code 3 when not signed in", async () => {
    const configDir = createTempDir();
    const cwd = createTempDir();
    try {
      const { exitCode, stderr } = await runCli(["up"], { configDir, cwd });
      expect(exitCode).toBe(3);
      expect(stderr).toContain("Not signed in");
    } finally {
      cleanDir(configDir);
      cleanDir(cwd);
    }
  });

  it("fails with exit code 4 when deployment fails", async () => {
    const configDir = createTempDir();
    const cwd = createTempDir();

    server.use(
      http.post(api("/services/:serviceId/deployments"), () => {
        const failedDep = fx.deployments.web.find((d) => d.status === "failed");
        return HttpResponse.json(failedDep, { status: 202 });
      }),
      http.get(api("/deployments/:id"), () => {
        const failedDetail = fx.deploymentDetails[fx.fixtureIds.deployments.webFailed];
        return HttpResponse.json(failedDetail);
      }),
      http.get(api("/deployments/:id/logs/stream"), () => {
        const streamText = 'event: end\ndata: {"status":"failed"}\n\n';
        return new HttpResponse(streamText, {
          headers: { "content-type": "text/event-stream" },
        });
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

      const linkDir = path.join(cwd, ".lift");
      fs.mkdirSync(linkDir, { recursive: true });
      fs.writeFileSync(
        path.join(linkDir, "project.json"),
        JSON.stringify({
          projectId: fx.fixtureIds.project,
          serviceId: fx.fixtureIds.services.web,
        }),
      );

      const { exitCode, stderr } = await runCli(["up"], {
        configDir,
        cwd,
      });

      expect(exitCode).toBe(4);
      expect(stderr).toMatch(/failed/i);
    } finally {
      cleanDir(configDir);
      cleanDir(cwd);
    }
  });
});
