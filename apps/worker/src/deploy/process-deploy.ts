import { appUrl, type DeployJob, type DeploymentErrorCode } from "@lift/shared";
import type { Docker } from "../docker";
import { type InternalApi, StopDeployment } from "../internal-api";
import type { LogSink } from "../log-sink";
import type { Logger } from "../logger";
import { containerSpec, PIDS_LIMIT } from "./container-spec";
import { containerName, EDGE_NETWORK, projectNetwork } from "./labels";
import { type ProbeResult, probe } from "./probe";

/** docs/prd/04-infrastructure.md, "Deploy job": poll every 2 s, give up after 120 s. */
export const HEALTH_TIMEOUT_MS = 120_000;
export const HEALTH_INTERVAL_MS = 2_000;
/** Old and new containers both serve this long, so no request fails during the swap. */
export const OVERLAP_MS = 10_000;
const LAST_LINES = 100;

export interface DeployDeps {
  api: InternalApi;
  docker: Docker;
  logSink: (deploymentId: string, secrets: string[]) => LogSink;
  appsDomain: string;
  probeContainer: string;
  log: Logger;
  healthTimeoutMs?: number;
  healthIntervalMs?: number;
  overlapMs?: number;
  /** Seam for tests; by default curl runs in the probe container. */
  probe?: (url: string) => Promise<ProbeResult>;
}

export type DeployOutcome = "active" | "failed" | "stopped";

type Health =
  | { kind: "healthy"; status: number; ms: number }
  | { kind: "crashed"; exitCode: number | null }
  | { kind: "unhealthy"; reason: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (ms: number) => `${ms / 1000}s`;

/** One deploy at a time per service: the next waits for the previous, overlap included. */
const serviceQueues = new Map<string, Promise<unknown>>();

/**
 * The deploy job (docs/prd/04-infrastructure.md, "Deploy job"): fetch the runtime environment,
 * make sure the networks exist, create and start the container, poll its health, then report
 * `active` and remove the service's previous container after the overlap. If it crashes or never
 * answers, its last lines are copied into the deployment's log, it is removed, the previous one
 * keeps serving, and the deployment fails with `crashed` or `healthcheck_failed`.
 */
export function processDeploy(job: DeployJob, deps: DeployDeps): Promise<DeployOutcome> {
  const previous = serviceQueues.get(job.serviceId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => deploy(job, deps));
  serviceQueues.set(job.serviceId, current);
  return current.finally(() => {
    if (serviceQueues.get(job.serviceId) === current) serviceQueues.delete(job.serviceId);
  });
}

async function waitHealthy(
  job: DeployJob,
  containerId: string,
  deps: DeployDeps,
  logs: LogSink,
): Promise<Health> {
  const timeoutMs = deps.healthTimeoutMs ?? HEALTH_TIMEOUT_MS;
  const intervalMs = deps.healthIntervalMs ?? HEALTH_INTERVAL_MS;
  const check = deps.probe ?? ((url: string) => probe(deps.docker, deps.probeContainer, url));
  const deadline = Date.now() + timeoutMs;
  let announced = false;
  let lastReason = "";
  for (;;) {
    const state = await deps.docker.inspectContainer(containerId);
    // Restarted even once means it exited: the restart policy hides crashes otherwise.
    if (!state?.State.Running || state.State.Restarting || state.RestartCount > 0) {
      return { kind: "crashed", exitCode: state?.State.ExitCode ?? null };
    }
    const ip = state.NetworkSettings.Networks[EDGE_NETWORK]?.IPAddress;
    let result: ProbeResult = {
      healthy: false,
      status: null,
      ms: null,
      reason: `no address on ${EDGE_NETWORK} yet`,
    };
    if (ip) {
      const url = `http://${ip}:${job.port}${job.healthcheckPath}`;
      if (!announced) {
        logs.write(
          "deploy",
          `Checking ${url} every ${seconds(intervalMs)}, for up to ${seconds(timeoutMs)}`,
        );
        announced = true;
      }
      result = await check(url);
    }
    if (result.healthy) return { kind: "healthy", status: result.status ?? 0, ms: result.ms ?? 0 };
    if (result.reason !== lastReason) {
      logs.write("deploy", `Health check: ${result.reason}, retrying`);
      lastReason = result.reason;
    }
    if (Date.now() >= deadline) return { kind: "unhealthy", reason: lastReason };
    await sleep(intervalMs);
  }
}

async function deploy(job: DeployJob, deps: DeployDeps): Promise<DeployOutcome> {
  const { api, docker, log } = deps;
  const id = job.deploymentId;
  const at = () => new Date().toISOString();
  const logs = deps.logSink(id, []);
  const name = containerName(job.serviceSlug, id);
  let containerId: string | null = null;
  let live = false;

  const fail = async (errorCode: DeploymentErrorCode, line: string): Promise<DeployOutcome> => {
    logs.system(line);
    await logs.flush();
    await api.reportStatus(id, { status: "failed", errorCode, message: line, at: at() });
    return "failed";
  };

  try {
    const env = await api.runtimeEnv(id);
    if (!(await docker.imageExists(job.imageTag))) {
      return await fail("image_missing", `Image ${job.imageTag} isn't on this machine`);
    }
    logs.write("deploy", `Image ${job.imageTag} is on this machine; no pull needed`);
    if (!(await docker.networkExists(EDGE_NETWORK))) {
      return await fail(
        "upstream_unavailable",
        `The ${EDGE_NETWORK} network is missing on the worker`,
      );
    }
    const probeState = await docker.inspectContainer(deps.probeContainer);
    if (!probeState?.State.Running) {
      return await fail(
        "upstream_unavailable",
        `The ${deps.probeContainer} container isn't running on the worker`,
      );
    }
    const network = projectNetwork(job.projectId);
    if (!(await docker.networkExists(network))) {
      await docker.createNetwork(network, { "lift.project": job.projectId });
    }
    // An earlier attempt at this deployment (a stalled job run again) may have left one behind.
    await docker.removeContainer(name);

    logs.write("deploy", `Creating container ${name}`);
    logs.write("deploy", `Networks: ${EDGE_NETWORK}, ${network} (alias ${job.serviceSlug})`);
    logs.write(
      "deploy",
      `Limits: ${job.cpu} vCPU, ${job.memoryMb} MB memory and swap, ${PIDS_LIMIT} processes`,
    );
    logs.write("deploy", `Routing ${job.hostnames.join(", ")} to port ${job.port}`);
    containerId = await docker.createContainer(
      name,
      containerSpec(job, env.variables, deps.appsDomain),
    );
    logs.write("deploy", "Starting container");
    await docker.startContainer(containerId);

    const health = await waitHealthy(job, containerId, deps, logs);
    if (health.kind !== "healthy") {
      const lines = await docker.logs(containerId, LAST_LINES).catch(() => [] as string[]);
      if (lines.length > 0) {
        logs.write(
          "deploy",
          `The app's last ${lines.length === 1 ? "line" : `${lines.length} lines`}:`,
        );
        for (const line of lines) logs.write("deploy", line);
      }
      await docker.removeContainer(containerId);
      containerId = null;
      if (health.kind === "crashed") {
        const code = health.exitCode === null ? "" : ` with code ${health.exitCode}`;
        return await fail("crashed", `Deploy failed: the app exited${code} before it answered`);
      }
      const limit = seconds(deps.healthTimeoutMs ?? HEALTH_TIMEOUT_MS);
      return await fail(
        "healthcheck_failed",
        `Deploy failed: no healthy answer on port ${job.port} within ${limit} (last: ${health.reason})`,
      );
    }

    logs.write("deploy", `Health check passed: ${health.status} in ${health.ms} ms`);
    const previous = (await docker.listContainers([`lift.service=${job.serviceId}`])).filter(
      (container) => container.Id !== containerId && container.Labels["lift.deployment"] !== id,
    );
    const overlapMs = deps.overlapMs ?? OVERLAP_MS;
    logs.system(`Deployment is live at ${appUrl(job.hostnames[0] ?? "", deps.appsDomain)}`);
    if (previous.length > 0) {
      logs.write(
        "deploy",
        `The previous deployment keeps serving for ${seconds(overlapMs)}, then its container is removed`,
      );
    }
    // The log ends with the report: nothing is written to it after `active`.
    await logs.flush();
    await api.reportStatus(id, { status: "active", containerId, at: at() });
    live = true;

    await sleep(overlapMs);
    for (const old of previous) {
      await docker.removeContainer(old.Id);
      log.info({ deploymentId: id, removed: old.Names[0] }, "removed the previous container");
    }
    return "active";
  } catch (error) {
    if (live) {
      // Serving already; a leftover old container is cleaned up by reconciliation (INF-12).
      log.warn({ err: error, deploymentId: id }, "couldn't remove the previous container");
      return "active";
    }
    if (containerId) await docker.removeContainer(containerId).catch(() => undefined);
    if (error instanceof StopDeployment) {
      log.info({ deploymentId: id, reason: error.message }, "the API stopped this deploy");
      await logs.flush();
      return "stopped";
    }
    log.error({ err: error, deploymentId: id }, "the deploy crashed");
    try {
      await fail("upstream_unavailable", "The deploy stopped on an error inside the worker");
    } catch {
      // The API can't be reached either; its backstop fails the deployment after 5 minutes.
    }
    throw error;
  }
}
