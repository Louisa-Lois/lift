import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type BuildContext,
  type BuildJob,
  type DeploymentStatusReport,
  imageTagFor,
} from "@lift/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tokenForms } from "../src/build/clone";
import { type BuildDeps, formatDuration, processBuild } from "../src/build/process-build";
import { type InternalApi, StopDeployment } from "../src/internal-api";
import type { LogSink } from "../src/log-sink";
import { createLogger } from "../src/logger";
import type { RunResult } from "../src/process";

const IDS = {
  deployment: "dep_aaaaaaaaaaaaaaaaaaaaaaaa",
  service: "svc_bbbbbbbbbbbbbbbbbbbbbbbb",
  project: "prj_cccccccccccccccccccccccc",
};
const SHA = "3f9c2a1b7d4e5f60718293a4b5c6d7e8f9012345";
const TOKEN = `gho_${"t".repeat(36)}`;
const IMAGE = imageTagFor(IDS.service, IDS.deployment);

const job: BuildJob = {
  deploymentId: IDS.deployment,
  serviceId: IDS.service,
  projectId: IDS.project,
  repo: { owner: "lift-demo", name: "next-hello", branch: "main" },
  commitSha: SHA,
  rootDir: ".",
  builder: "railpack",
};

const context = (overrides: Partial<BuildContext> = {}): BuildContext => ({
  deploymentId: IDS.deployment,
  serviceId: IDS.service,
  projectId: IDS.project,
  repo: { owner: "lift-demo", name: "next-hello", branch: "main" },
  commitSha: SHA,
  rootDir: ".",
  builder: "railpack",
  dockerfilePath: null,
  buildCommand: null,
  startCommand: null,
  clone: { token: TOKEN, expiresAt: null },
  buildVariables: {},
  ...overrides,
});

let buildDir: string;
beforeAll(async () => {
  buildDir = await mkdtemp(path.join(tmpdir(), "lift-build-test-"));
});
afterAll(async () => {
  await rm(buildDir, { recursive: true, force: true });
});

/**
 * One build with fakes all round. `events` records lines, flushes and reports in order, so a test
 * can check that every line was flushed before the report that ends the build.
 */
function setup(
  options: {
    context?: Partial<BuildContext>;
    stopOn?: DeploymentStatusReport["status"];
    clone?: RunResult;
    build?: RunResult | Error;
    imageExists?: boolean;
  } = {},
) {
  const events: string[] = [];
  const reports: DeploymentStatusReport[] = [];
  let secrets: string[] = [];
  const api = {
    async reportStatus(_id: string, report: DeploymentStatusReport) {
      events.push(`report:${report.status}`);
      if (report.status === options.stopOn) throw new StopDeployment("It is canceled");
      reports.push(report);
      return { status: report.status };
    },
    async buildContext() {
      events.push("build-context");
      return context(options.context);
    },
    async runtimeEnv() {
      throw new Error("not used by builds");
    },
    async provisionContext() {
      throw new Error("not used here");
    },
    async reportDatabase() {
      throw new Error("not used here");
    },
  } as InternalApi;
  const sink: LogSink = {
    write: (stream, line) => events.push(`${stream}:${line}`),
    system: (line) => events.push(`system:${line}`),
    flush: async () => {
      events.push("flush");
    },
  };
  const deps: BuildDeps = {
    api,
    logSink: (_id, given) => {
      secrets = given;
      return sink;
    },
    buildDir,
    buildkitHost: "tcp://buildkit:1234",
    log: createLogger("silent"),
    timeoutMs: 60_000,
    clone: async (input) => {
      await mkdir(input.dir, { recursive: true });
      input.onLine("Receiving objects: 100% (42/42)");
      return options.clone ?? { code: 0, timedOut: false };
    },
    buildImage: async (input) => {
      events.push(`build:${input.imageTag}:${path.relative(buildDir, input.dir)}`);
      if (options.build instanceof Error) throw options.build;
      input.onLine("#7 [install] npm ci");
      return options.build ?? { code: 0, timedOut: false };
    },
    imageExists: async () => options.imageExists ?? true,
  };
  return { deps, events, reports, secrets: () => secrets };
}

const systemLines = (events: string[]) =>
  events.filter((event) => event.startsWith("system:")).map((event) => event.slice(7));

async function gone(dir: string): Promise<boolean> {
  try {
    await stat(dir);
    return false;
  } catch {
    return true;
  }
}

describe("the build job", () => {
  it("passes the service's variables to Railpack, except the tools' own, and scrubs their values", async () => {
    const { deps, events, secrets } = setup({
      context: {
        buildVariables: {
          API_SECRET: "s3cr3t-value-1234",
          NEXT_PUBLIC_GREETING: "hi",
          NODE_ENV: "production",
          PATH: "/evil/bin",
        },
      },
    });
    let given: Record<string, string> = {};
    const build = deps.buildImage;
    deps.buildImage = async (input) => {
      given = input.buildVariables;
      return build ? build(input) : { code: 0, timedOut: false };
    };
    expect(await processBuild(job, deps)).toBe("deploying");
    expect(given).toEqual({
      API_SECRET: "s3cr3t-value-1234",
      NEXT_PUBLIC_GREETING: "hi",
      NODE_ENV: "production",
    });
    expect(systemLines(events)).toContain(
      "Not passing PATH to the build: the build tools use their own. The app gets it when it runs.",
    );
    expect(secrets()).toContain("s3cr3t-value-1234");
    expect(secrets()).not.toContain("production");
  });

  it("clones, builds, then reports deploying with the image, every line flushed first", async () => {
    const { deps, events, reports, secrets } = setup();
    expect(await processBuild(job, deps)).toBe("deploying");
    expect(reports.map((report) => report.status)).toEqual(["building", "deploying"]);
    expect(reports[1]).toMatchObject({ status: "deploying", imageTag: IMAGE });
    expect(systemLines(events)).toEqual([
      "Cloning lift-demo/next-hello at 3f9c2a1",
      expect.stringMatching(/^Cloned in \d+\.\ds$/),
      "Building with Railpack",
      expect.stringMatching(/^Image built in /),
    ]);
    expect(events).toContain("build:Receiving objects: 100% (42/42)");
    expect(events).toContain(`build:${IMAGE}:${IDS.deployment}`);
    expect(events.slice(-2)).toEqual(["flush", "report:deploying"]);
    expect(secrets()).toEqual(tokenForms(TOKEN));
    expect(await gone(path.join(buildDir, IDS.deployment))).toBe(true);
  });

  it("builds the service's root directory", async () => {
    const { deps, events } = setup({ context: { rootDir: "apps/web" } });
    deps.clone = async (input) => {
      await mkdir(path.join(input.dir, "apps", "web"), { recursive: true });
      return { code: 0, timedOut: false };
    };
    expect(await processBuild(job, deps)).toBe("deploying");
    expect(events).toContain(`build:${IMAGE}:${path.join(IDS.deployment, "apps", "web")}`);
  });

  it("stops quietly when the API says the deployment moved on", async () => {
    const { deps, events } = setup({ stopOn: "building" });
    expect(await processBuild(job, deps)).toBe("stopped");
    expect(events).toEqual(["report:building"]);
  });

  it.each([
    [
      "a failed clone",
      { clone: { code: 128, timedOut: false } },
      "clone_failed",
      "Clone failed: git exited with code 128",
    ],
    [
      "a failed build",
      { build: { code: 1, timedOut: false } },
      "build_failed",
      /^Build failed after .+: railpack exited with code 1$/,
    ],
    [
      "a build past the time limit",
      { build: { code: null, timedOut: true } },
      "build_timeout",
      /^Build stopped after .+: a build may take at most 1m 00s$/,
    ],
    [
      "an image Docker doesn't have",
      { imageExists: false },
      "build_failed",
      `Railpack finished, but Docker has no image ${IMAGE}`,
    ],
    [
      "a Dockerfile service",
      { context: { builder: "dockerfile" as const } },
      "build_failed",
      /^Dockerfile builds arrive with INF-13/,
    ],
    [
      "a root directory that isn't there",
      { context: { rootDir: "apps/missing" } },
      "build_failed",
      "The root directory apps/missing isn't in the repo at 3f9c2a1",
    ],
  ])("reports %s as failed with its code", async (_case, options, errorCode, message) => {
    const { deps, events, reports } = setup(options);
    expect(await processBuild(job, deps)).toBe("failed");
    const failure = reports.at(-1);
    expect(failure).toMatchObject({ status: "failed", errorCode });
    expect(failure?.status === "failed" && failure.message).toEqual(
      typeof message === "string" ? message : expect.stringMatching(message),
    );
    // The reason is the log's last line, flushed before the report.
    expect(events.slice(-3)).toEqual([
      `system:${failure?.status === "failed" ? failure.message : ""}`,
      "flush",
      "report:failed",
    ]);
    expect(await gone(path.join(buildDir, IDS.deployment))).toBe(true);
  });

  it("says plainly when a tool isn't installed", async () => {
    const missing = Object.assign(new Error("spawn railpack ENOENT"), {
      code: "ENOENT",
      path: "railpack",
    });
    const { deps, reports } = setup({ build: missing });
    expect(await processBuild(job, deps)).toBe("failed");
    expect(reports.at(-1)).toMatchObject({
      status: "failed",
      errorCode: "build_failed",
      message: "The worker can't run railpack: it isn't installed",
    });
  });

  it("tells the API about a crash, then lets BullMQ record it", async () => {
    const { deps, reports } = setup({ build: new Error("BuildKit went away") });
    await expect(processBuild(job, deps)).rejects.toThrow("BuildKit went away");
    expect(reports.at(-1)).toMatchObject({ status: "failed", errorCode: "build_failed" });
    expect(await gone(path.join(buildDir, IDS.deployment))).toBe(true);
  });
});

describe("durations", () => {
  it.each([
    [1_200, "1.2s"],
    [59_940, "59.9s"],
    [123_000, "2m 03s"],
    [15 * 60_000, "15m 00s"],
  ])("%d ms reads %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});
