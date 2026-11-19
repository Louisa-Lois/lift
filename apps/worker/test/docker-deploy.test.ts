import { randomBytes } from "node:crypto";
import http from "node:http";
import { type DeployJob, type DeploymentStatusReport, REDIS_STREAMS } from "@lift/shared";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { projectNetwork } from "../src/deploy/labels";
import { type DeployDeps, processDeploy } from "../src/deploy/process-deploy";
import { createDocker } from "../src/docker";
import type { InternalApi } from "../src/internal-api";
import { createLogSink } from "../src/log-sink";
import { createLogger } from "../src/logger";

// Real deploys on the local stack: Docker, lift-edge, lift-probe and the dev Traefik. Opt-in:
//   pnpm stack:up && pnpm --filter @lift/worker test:docker
// with LIFT_APPS_PORT set if the stack's Traefik isn't on port 80. The images are public and
// small: traefik/whoami answers HTTP, hello-world exits, pause never listens.

const enabled = process.env.LIFT_DOCKER_TESTS === "1";
const APPS_PORT = Number(process.env.LIFT_APPS_PORT ?? 80);
const id = (prefix: string) => `${prefix}_${randomBytes(12).toString("hex")}`;
const PROJECT = id("prj");
const docker = createDocker();
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { lazyConnect: true });
const services: string[] = [];
const deployments: string[] = [];
const reports = new Map<string, DeploymentStatusReport[]>();

const api = {
  async runtimeEnv(deploymentId: string) {
    return {
      deploymentId,
      envHash: "test",
      variables: [{ key: "PORT", value: "80", source: "system" as const }],
    };
  },
  async reportStatus(deploymentId: string, report: DeploymentStatusReport) {
    reports.set(deploymentId, [...(reports.get(deploymentId) ?? []), report]);
    return { status: report.status };
  },
  async buildContext() {
    throw new Error("not used");
  },
} as InternalApi;

const log = createLogger("silent");
const deps: DeployDeps = {
  api,
  docker,
  logSink: (deploymentId, secrets) => createLogSink(redis, deploymentId, { secrets, log }),
  appsDomain: "apps.localhost",
  probeContainer: "lift-probe",
  log,
  healthTimeoutMs: 6_000,
  overlapMs: 1_000,
};

function jobFor(serviceId: string, imageTag: string, hostname: string): DeployJob {
  const deploymentId = id("dep");
  deployments.push(deploymentId);
  return {
    deploymentId,
    serviceId,
    serviceSlug: "web",
    projectId: PROJECT,
    imageTag,
    port: 80,
    healthcheckPath: "/",
    cpu: 0.25,
    memoryMb: 128,
    hostnames: [hostname],
  };
}

/** GET through the dev Traefik with a Host header, retried while Traefik picks up the route. */
async function viaTraefik(hostname: string): Promise<{ status: number; body: string }> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      http
        .get(
          { host: "127.0.0.1", port: APPS_PORT, path: "/", headers: { host: hostname } },
          (res) => {
            let body = "";
            res.on("data", (chunk) => {
              body += chunk;
            });
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
          },
        )
        .on("error", reject);
    });
    if (result.status === 200 || Date.now() > deadline) return result;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function lines(deploymentId: string): Promise<string[]> {
  const entries = await redis.xrange(REDIS_STREAMS.deploymentLogs.key(deploymentId), "-", "+");
  return entries.map(([, fields]) => fields[5] ?? "");
}

afterAll(async () => {
  if (!enabled) return;
  for (const serviceId of services) {
    for (const container of await docker.listContainers([`lift.service=${serviceId}`])) {
      await docker.removeContainer(container.Id);
    }
  }
  await docker.removeNetwork(projectNetwork(PROJECT));
  for (const deploymentId of deployments) {
    await redis.del(REDIS_STREAMS.deploymentLogs.key(deploymentId));
  }
  redis.disconnect();
});

describe.skipIf(!enabled)("real deploys on the local stack", () => {
  it("serves an app through Traefik, then swaps it for the next deployment", async () => {
    const service = id("svc");
    services.push(service);
    const hostname = `whoami-${service.slice(-6)}.apps.localhost`;

    const first = jobFor(service, "traefik/whoami:v1.11.0", hostname);
    expect(await processDeploy(first, deps)).toBe("active");
    expect(reports.get(first.deploymentId)?.at(-1)).toMatchObject({ status: "active" });
    const answer = await viaTraefik(hostname);
    expect(answer.status).toBe(200);
    expect(answer.body).toContain("Hostname:");
    expect((await lines(first.deploymentId)).at(-1)).toBe(
      `Deployment is live at http://${hostname}`,
    );

    const second = jobFor(service, "traefik/whoami:v1.11.0", hostname);
    expect(await processDeploy(second, deps)).toBe("active");
    const left = await docker.listContainers([`lift.service=${service}`]);
    expect(left.map((container) => container.Labels["lift.deployment"])).toEqual([
      second.deploymentId,
    ]);
    expect((await viaTraefik(hostname)).status).toBe(200);
  }, 60_000);

  it("fails an app that exits, keeping its output in the log", async () => {
    const service = id("svc");
    services.push(service);
    const job = jobFor(service, "hello-world:latest", `hello-${service.slice(-6)}.apps.localhost`);
    expect(await processDeploy(job, deps)).toBe("failed");
    expect(reports.get(job.deploymentId)?.at(-1)).toMatchObject({ errorCode: "crashed" });
    expect(await lines(job.deploymentId)).toContain("Hello from Docker!");
    expect(await docker.listContainers([`lift.service=${service}`])).toEqual([]);
  }, 60_000);

  it("fails an app that never answers", async () => {
    const service = id("svc");
    services.push(service);
    const job = jobFor(
      service,
      "registry.k8s.io/pause:3.10",
      `pause-${service.slice(-6)}.apps.localhost`,
    );
    expect(await processDeploy(job, deps)).toBe("failed");
    expect(reports.get(job.deploymentId)?.at(-1)).toMatchObject({
      errorCode: "healthcheck_failed",
      message: "Deploy failed: no healthy answer on port 80 within 6s (last: connection refused)",
    });
    expect(await docker.listContainers([`lift.service=${service}`])).toEqual([]);
  }, 60_000);
});
