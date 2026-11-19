import type { DeployJob, DeploymentStatusReport, RuntimeEnv } from "@lift/shared";
import { describe, expect, it } from "vitest";
import type { ProbeResult } from "../src/deploy/probe";
import { type DeployDeps, processDeploy } from "../src/deploy/process-deploy";
import { type InternalApi, StopDeployment } from "../src/internal-api";
import type { LogSink } from "../src/log-sink";
import { createLogger } from "../src/logger";
import { type FakeDockerSetup, fakeDocker } from "./helpers/fake-docker";

const SERVICE = "svc_bbbbbbbbbbbbbbbbbbbbbbbb";
const PROJECT = "prj_cccccccccccccccccccccccc";

const jobFor = (deploymentId: string): DeployJob => ({
  deploymentId,
  serviceId: SERVICE,
  serviceSlug: "web",
  projectId: PROJECT,
  imageTag: `lift/${SERVICE}:${deploymentId}`,
  port: 3000,
  healthcheckPath: "/health",
  cpu: 0.5,
  memoryMb: 512,
  hostnames: ["web-demo-shop.apps.localhost"],
});
const job = jobFor("dep_aaaaaaaaaaaaaaaaaa1b2c3d");

const env = (deploymentId: string): RuntimeEnv => ({
  deploymentId,
  envHash: "hash",
  variables: [{ key: "PORT", value: "3000", source: "system" }],
});

const refused: ProbeResult = {
  healthy: false,
  status: null,
  ms: null,
  reason: "connection refused",
};
const ok: ProbeResult = { healthy: true, status: 200, ms: 5, reason: "answered 200" };

/**
 * One deploy with a fake Docker, API and probe. `events` interleaves log lines, flushes, reports
 * and Docker calls in order, so tests can check what happened before and after `active`.
 */
function setup(
  options: {
    docker?: FakeDockerSetup;
    probes?: ProbeResult[];
    stopOnActive?: boolean;
    jobs?: DeployJob[];
  } = {},
) {
  const events: string[] = [];
  const reports: DeploymentStatusReport[] = [];
  const images = (options.jobs ?? [job]).map((each) => each.imageTag);
  const fake = fakeDocker({ images, ...options.docker });
  const docker = new Proxy(fake.docker, {
    get(target, key: keyof typeof fake.docker) {
      const value = target[key];
      if (key !== "removeContainer" && key !== "createContainer") return value;
      return async (...args: unknown[]) => {
        events.push(`docker:${key}:${String(args[0])}`);
        return (value as (...a: unknown[]) => unknown)(...args);
      };
    },
  });
  const probes = [...(options.probes ?? [ok])];
  const api = {
    async runtimeEnv(deploymentId: string) {
      return env(deploymentId);
    },
    async reportStatus(_id: string, report: DeploymentStatusReport) {
      events.push(`report:${report.status}`);
      if (report.status === "active" && options.stopOnActive) throw new StopDeployment("canceled");
      reports.push(report);
      return { status: report.status };
    },
    async buildContext() {
      throw new Error("not used by deploys");
    },
  } as InternalApi;
  const sink: LogSink = {
    write: (stream, line) => events.push(`${stream}:${line}`),
    system: (line) => events.push(`system:${line}`),
    flush: async () => {
      events.push("flush");
    },
  };
  const deps: DeployDeps = {
    api,
    docker,
    logSink: () => sink,
    appsDomain: "apps.localhost",
    probeContainer: "lift-probe",
    log: createLogger("silent"),
    healthTimeoutMs: 40,
    healthIntervalMs: 5,
    overlapMs: 0,
    probe: async () => probes.shift() ?? probes.at(-1) ?? refused,
  };
  return { deps, events, reports, fake };
}

const OLD = {
  id: "old-1",
  name: "lift-web-0ld000",
  labels: { "lift.service": SERVICE, "lift.deployment": "dep_old0000000000000000000" },
};

describe("the deploy job", () => {
  it("starts the container, waits for health, reports active, then removes the previous one", async () => {
    const { deps, events, reports, fake } = setup({
      docker: { existing: [OLD] },
      probes: [refused, refused, ok],
    });
    expect(await processDeploy(job, deps)).toBe("active");

    expect(reports).toEqual([expect.objectContaining({ status: "active", containerId: "new-2" })]);
    expect(fake.calls).toContain(`network:lift-prj-${PROJECT}:{"lift.project":"${PROJECT}"}`);
    const created = fake.containers.get("new-2");
    expect(created?.name).toBe("lift-web-1b2c3d");
    expect(created?.body?.Env).toEqual(["PORT=3000"]);

    const lines = events.filter((event) => /^(deploy|system):/.test(event));
    expect(lines).toEqual([
      `deploy:Image ${job.imageTag} is on this machine; no pull needed`,
      "deploy:Creating container lift-web-1b2c3d",
      `deploy:Networks: lift-edge, lift-prj-${PROJECT} (alias web)`,
      "deploy:Limits: 0.5 vCPU, 512 MB memory and swap, 256 processes",
      "deploy:Routing web-demo-shop.apps.localhost to port 3000",
      "deploy:Starting container",
      "deploy:Checking http://172.18.0.9:3000/health every 0.005s, for up to 0.04s",
      "deploy:Health check: connection refused, retrying",
      "deploy:Health check passed: 200 in 5 ms",
      "system:Deployment is live at http://web-demo-shop.apps.localhost",
      "deploy:The previous deployment keeps serving for 0s, then its container is removed",
    ]);
    // Every line is flushed before `active`; the old container goes only after it.
    const report = events.indexOf("report:active");
    expect(events[report - 1]).toBe("flush");
    expect(events.indexOf("docker:removeContainer:old-1")).toBeGreaterThan(report);
  });

  it("removes what an earlier attempt at the same deployment left behind", async () => {
    const { deps, events } = setup();
    await processDeploy(job, deps);
    expect(events.indexOf("docker:removeContainer:lift-web-1b2c3d")).toBeLessThan(
      events.indexOf("docker:createContainer:lift-web-1b2c3d"),
    );
  });

  it("fails as crashed when the app exits, with its last lines, keeping the old one", async () => {
    const { deps, events, reports, fake } = setup({
      docker: { existing: [OLD], behaviour: "exits", logs: ["Error: Cannot find module 'next'"] },
    });
    expect(await processDeploy(job, deps)).toBe("failed");
    expect(reports).toEqual([
      expect.objectContaining({
        status: "failed",
        errorCode: "crashed",
        message: "Deploy failed: the app exited with code 1 before it answered",
      }),
    ]);
    expect(events).toContain("deploy:The app's last line:");
    expect(events).toContain("deploy:Error: Cannot find module 'next'");
    expect(fake.containers.get("new-2")?.removed).toBe(true);
    expect(fake.containers.get("old-1")?.removed).toBe(false);
  });

  it("fails as healthcheck_failed when the app never answers in time", async () => {
    const { deps, reports, fake } = setup({ docker: { existing: [OLD] }, probes: [refused] });
    expect(await processDeploy(job, deps)).toBe("failed");
    expect(reports[0]).toMatchObject({
      status: "failed",
      errorCode: "healthcheck_failed",
      message:
        "Deploy failed: no healthy answer on port 3000 within 0.04s (last: connection refused)",
    });
    expect(fake.containers.get("new-2")?.removed).toBe(true);
    expect(fake.containers.get("old-1")?.removed).toBe(false);
  });

  it("removes the new container when the API refuses `active`", async () => {
    const { deps, fake } = setup({ docker: { existing: [OLD] }, stopOnActive: true });
    expect(await processDeploy(job, deps)).toBe("stopped");
    expect(fake.containers.get("new-2")?.removed).toBe(true);
    expect(fake.containers.get("old-1")?.removed).toBe(false);
  });

  it.each([
    [
      "the image is gone",
      { images: [] },
      "image_missing",
      `Image ${job.imageTag} isn't on this machine`,
    ],
    [
      "lift-edge is missing",
      { networks: [] },
      "upstream_unavailable",
      "The lift-edge network is missing on the worker",
    ],
    [
      "the probe isn't running",
      { probeRunning: false },
      "upstream_unavailable",
      "The lift-probe container isn't running on the worker",
    ],
  ])("fails before creating anything when %s", async (_case, docker, errorCode, message) => {
    const { deps, reports, fake } = setup({ docker });
    expect(await processDeploy(job, deps)).toBe("failed");
    expect(reports).toEqual([expect.objectContaining({ errorCode, message })]);
    expect(fake.calls.filter((call) => call.startsWith("create:"))).toEqual([]);
  });

  it("deploys one at a time per service", async () => {
    const second = jobFor("dep_aaaaaaaaaaaaaaaaaa9z9z9z");
    const { deps, events } = setup({ jobs: [job, second] });
    await Promise.all([processDeploy(job, deps), processDeploy(second, deps)]);
    const firstActive = events.indexOf("report:active");
    expect(events.indexOf("docker:createContainer:lift-web-9z9z9z")).toBeGreaterThan(firstActive);
  });
});
