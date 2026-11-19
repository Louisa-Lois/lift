import { mkdir } from "node:fs/promises";
import { BuildJob, DeployJob, OpsJob, QUEUE_NAMES } from "@lift/shared";
import { type Job, Worker } from "bullmq";
import { Redis } from "ioredis";
import { processBuild } from "./build/process-build";
import { processDeploy } from "./deploy/process-deploy";
import { createDocker } from "./docker";
import { missingTools } from "./doctor";
import { type Env, loadEnv } from "./env";
import { createInternalApi } from "./internal-api";
import { createLogSink } from "./log-sink";
import { createLogger } from "./logger";
import { processOp } from "./ops/process-ops";

// The worker agent (docs/prd/04-infrastructure.md). INF-04 consumes the build queue; INF-05 the
// deploy queue; INF-10 the ops queue; INF-09 ships logs and metrics; INF-12 reconciles.

let env: Env;
try {
  env = loadEnv();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
const log = createLogger(env.LOG_LEVEL);
const closers: (() => Promise<unknown>)[] = [];

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    log.info({ signal }, "worker stopping");
    // Running jobs are abandoned; BullMQ hands stalled ones out again, and every job is
    // idempotent by deploymentId.
    await Promise.allSettled(closers.map((close) => close()));
    process.exit(0);
  });
}

async function start(env: Env): Promise<void> {
  if (!env.WORKER_TOKEN) {
    log.warn("WORKER_TOKEN isn't set, so the worker stays idle. Run `pnpm env:init`.");
    setInterval(() => {}, 60_000);
    return;
  }
  const missing = await missingTools();
  if (missing.length > 0) {
    const message = `missing build tools: ${missing.join(", ")} (see apps/worker/README.md)`;
    if (env.NODE_ENV === "production") throw new Error(message);
    log.warn(`${message}. Builds will fail until they are installed.`);
  }
  const docker = createDocker();
  if (!(await docker.ping())) {
    const message =
      "Docker isn't reachable; set DOCKER_HOST to its unix socket if it isn't standard";
    if (env.NODE_ENV === "production") throw new Error(message);
    log.warn(`${message}. Deploys will fail until it is.`);
  }
  await mkdir(env.BUILD_DIR, { recursive: true, mode: 0o700 });

  const api = createInternalApi({ baseUrl: env.CONTROL_API_URL, token: env.WORKER_TOKEN });
  // BullMQ blocks on its connection, so log lines get one of their own.
  const queueRedis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const logRedis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
  for (const redis of [queueRedis, logRedis]) {
    redis.on("error", (error) => log.warn({ err: error }, "Redis connection problem"));
  }

  const logSink = (deploymentId: string, secrets: string[]) =>
    createLogSink(logRedis, deploymentId, { secrets, log });
  const options = (concurrency: number) => ({ connection: queueRedis, concurrency });
  // docs/prd/04-infrastructure.md: builds are CPU-bound; deploys and ops run 4 at a time.
  const workers = [
    new Worker(
      QUEUE_NAMES.build,
      (job: Job) =>
        processBuild(BuildJob.parse(job.data), {
          api,
          logSink,
          buildDir: env.BUILD_DIR,
          buildkitHost: env.BUILDKIT_HOST,
          log,
        }),
      options(env.BUILD_CONCURRENCY),
    ),
    new Worker(
      QUEUE_NAMES.deploy,
      (job: Job) =>
        processDeploy(DeployJob.parse(job.data), {
          api,
          docker,
          logSink,
          appsDomain: env.APPS_DOMAIN,
          probeContainer: env.PROBE_CONTAINER,
          log,
        }),
      options(4),
    ),
    new Worker(
      QUEUE_NAMES.ops,
      (job: Job) => processOp(OpsJob.parse(job.data), { docker, log }),
      options(4),
    ),
  ];
  for (const worker of workers) {
    const queue = worker.name;
    worker.on("completed", (job, outcome) =>
      log.info({ queue, jobId: job.id, outcome }, "job finished"),
    );
    worker.on("failed", (job, error) =>
      log.error({ queue, jobId: job?.id, err: error }, "job failed"),
    );
    worker.on("error", (error) => log.error({ queue, err: error }, "queue error"));
  }
  closers.push(
    () => Promise.all(workers.map((worker) => worker.close())),
    async () => {
      queueRedis.disconnect();
      logRedis.disconnect();
    },
  );
  log.info(
    { buildConcurrency: env.BUILD_CONCURRENCY, buildDir: env.BUILD_DIR, api: env.CONTROL_API_URL },
    `worker started (${env.NODE_ENV}); consuming ${workers.map((worker) => worker.name).join(", ")}`,
  );
}

start(env).catch((error) => {
  log.fatal({ err: error }, "worker failed to start");
  process.exit(1);
});
