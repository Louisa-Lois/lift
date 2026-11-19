import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type BuildContext,
  type BuildJob,
  type DeploymentStatusReport,
  INTERNAL_BASE_PATH,
  imageTagFor,
  REDIS_STREAMS,
} from "@lift/shared";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cloneCommit } from "../src/build/clone";
import { processBuild } from "../src/build/process-build";
import { createInternalApi } from "../src/internal-api";
import { createLogSink } from "../src/log-sink";
import { createLogger } from "../src/logger";
import { childEnv, run } from "../src/process";

// A real build: git, Railpack, the local stack's BuildKit and Docker. Opt-in, because it needs
// Docker and takes minutes the first time (Railpack pulls its images):
//   pnpm stack:up && pnpm --filter @lift/worker test:docker
// The internal API is a fake that speaks the contract, and the repo is local, so no GitHub token
// is involved.

const enabled = process.env.LIFT_DOCKER_TESTS === "1";
const IDS = {
  deployment: `dep_${Date.now().toString(36).padStart(24, "0")}`,
  service: "svc_dockertestdockertestdock",
  project: "prj_dockertestdockertestdock",
};
const TOKEN = "w".repeat(40);
const IMAGE = imageTagFor(IDS.service, IDS.deployment);

let work: string;
let remote: string;
let sha: string;
let server: Server;
let baseUrl: string;
const reports: DeploymentStatusReport[] = [];
let refuseBuilding = false;
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { lazyConnect: true });

async function git(cwd: string, ...args: string[]): Promise<string> {
  const lines: string[] = [];
  const env = childEnv({
    GIT_AUTHOR_NAME: "Lift",
    GIT_AUTHOR_EMAIL: "lift@example.test",
    GIT_COMMITTER_NAME: "Lift",
    GIT_COMMITTER_EMAIL: "lift@example.test",
  });
  const result = await run("git", args, { cwd, env, onLine: (line) => lines.push(line) });
  if (result.code !== 0) throw new Error(`git ${args.join(" ")}: ${lines.join("\n")}`);
  return lines.join("\n");
}

const context = (): BuildContext => ({
  deploymentId: IDS.deployment,
  serviceId: IDS.service,
  projectId: IDS.project,
  repo: { owner: "lift-demo", name: "hello", branch: "main" },
  commitSha: sha,
  rootDir: ".",
  builder: "railpack",
  dockerfilePath: null,
  buildCommand: null,
  startCommand: null,
  clone: { token: "not-used-for-a-local-repo", expiresAt: null },
  buildVariables: {},
});

beforeAll(async () => {
  if (!enabled) return;
  work = await mkdtemp(path.join(tmpdir(), "lift-docker-test-"));
  const source = path.join(work, "hello");
  await git(work, "init", "--quiet", "--initial-branch", "main", source);
  await writeFile(
    path.join(source, "package.json"),
    JSON.stringify({ name: "hello", version: "1.0.0", scripts: { start: "node server.js" } }),
  );
  await writeFile(
    path.join(source, "server.js"),
    "require('node:http').createServer((_, res) => res.end('hello from lift')).listen(process.env.PORT || 3000);\n",
  );
  await git(source, "add", ".");
  await git(source, "commit", "--quiet", "-m", "hello");
  sha = await git(source, "rev-parse", "HEAD");
  const bare = path.join(work, "hello.git");
  await git(work, "clone", "--quiet", "--bare", source, bare);
  await git(bare, "config", "uploadpack.allowAnySHA1InWant", "true");
  remote = `file://${bare}`;

  // The control plane's internal routes, as far as builds use them.
  server = createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${TOKEN}`) {
      response.writeHead(401).end();
      return;
    }
    const prefix = `${INTERNAL_BASE_PATH}/deployments/${IDS.deployment}`;
    if (request.method === "GET" && request.url === `${prefix}/build-context`) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(context()));
      return;
    }
    if (request.method === "POST" && request.url === `${prefix}/status`) {
      let body = "";
      for await (const chunk of request) body += chunk;
      const report = JSON.parse(body) as DeploymentStatusReport;
      if (report.status === "building" && refuseBuilding) {
        response.writeHead(409, { "content-type": "application/problem+json" });
        response.end(JSON.stringify({ code: "conflict", detail: "It is canceled" }));
        return;
      }
      reports.push(report);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ status: report.status }));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 60_000);

afterAll(async () => {
  if (!enabled) return;
  server?.close();
  await redis.del(REDIS_STREAMS.deploymentLogs.key(IDS.deployment));
  redis.disconnect();
  await run("docker", ["image", "rm", "--force", IMAGE], { env: childEnv() });
  await rm(work, { recursive: true, force: true });
});

const job: BuildJob = {
  deploymentId: IDS.deployment,
  serviceId: IDS.service,
  projectId: IDS.project,
  repo: { owner: "lift-demo", name: "hello", branch: "main" },
  commitSha: "0".repeat(40),
  rootDir: ".",
  builder: "railpack",
};

function deps(buildDir: string) {
  const log = createLogger("silent");
  return {
    api: createInternalApi({ baseUrl, token: TOKEN, retryDelaysMs: [] }),
    logSink: (deploymentId: string, secrets: string[]) =>
      createLogSink(redis, deploymentId, { secrets, log }),
    buildDir,
    buildkitHost: process.env.BUILDKIT_HOST ?? "tcp://localhost:1234",
    log,
    clone: (input: Parameters<typeof cloneCommit>[0]) =>
      cloneCommit({ ...input, remoteUrl: remote }),
  };
}

describe.skipIf(!enabled)("a real build with Railpack and BuildKit", () => {
  it("does nothing when the API refuses `building`", async () => {
    refuseBuilding = true;
    try {
      expect(await processBuild(job, deps(path.join(work, "builds")))).toBe("stopped");
      expect(reports).toEqual([]);
    } finally {
      refuseBuilding = false;
    }
  });

  it(
    "builds the commit into lift/{service}:{deployment} and reports it",
    async () => {
      const buildDir = path.join(work, "builds");
      expect(await processBuild(job, deps(buildDir))).toBe("deploying");
      expect(reports.map((report) => report.status)).toEqual(["building", "deploying"]);
      expect(reports[1]).toMatchObject({ imageTag: IMAGE });

      const inspected = await run("docker", ["image", "inspect", IMAGE], { env: childEnv() });
      expect(inspected.code).toBe(0);
      const entries = await redis.xrange(
        REDIS_STREAMS.deploymentLogs.key(IDS.deployment),
        "-",
        "+",
      );
      const lines = entries.map(([, fields]) => `${fields[3]}: ${fields[5]}`);
      expect(lines[0]).toBe(`system: Cloning lift-demo/hello at ${sha.slice(0, 7)}`);
      expect(lines.some((line) => line.startsWith("build: "))).toBe(true);
      expect(lines.at(-1)).toMatch(/^system: Image built in /);
      await expect(stat(path.join(buildDir, IDS.deployment))).rejects.toThrow();
    },
    20 * 60_000,
  );
});
