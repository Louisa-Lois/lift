import { mkdir } from "node:fs/promises";
import { BuildJob, QUEUE_NAMES } from "@lift/shared";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { processBuild } from "./build/process-build";
import { missingTools } from "./doctor";
import { type Env, loadEnv } from "./env";
import { createInternalApi } from "./internal-api";
import { createLogSink } from "./log-sink";
import { createLogger } from "./logger";

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
  await mkdir(env.BUILD_DIR, { recursive: true, mode: 0o700 });

  const api = createInternalApi({ baseUrl: env.CONTROL_API_URL, token: env.WORKER_TOKEN });
  // BullMQ blocks on its connection, so log lines get one of their own.
  const queueRedis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const logRedis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
  for (const redis of [queueRedis, logRedis]) {
    redis.on("error", (error) => log.warn({ err: error }, "Redis connection problem"));
  }

  const builds = new Worker(
    QUEUE_NAMES.build,
    async (job) =>
      processBuild(BuildJob.parse(job.data), {
        api,
        logSink: (deploymentId, secrets) => createLogSink(logRedis, deploymentId, { secrets, log }),
        buildDir: env.BUILD_DIR,
        buildkitHost: env.BUILDKIT_HOST,
        log,
      }),
    { connection: queueRedis, concurrency: env.BUILD_CONCURRENCY },
  );
  builds.on("completed", (job, outcome) =>
    log.info({ deploymentId: job.data.deploymentId, outcome }, "build finished"),
  );
  builds.on("failed", (job, error) =>
    log.error({ deploymentId: job?.data.deploymentId, err: error }, "build job failed"),
  );
  builds.on("error", (error) => log.error({ err: error }, "build queue error"));
  closers.push(
    () => builds.close(),
    async () => {
      queueRedis.disconnect();
      logRedis.disconnect();
    },
  );
  log.info(
    { buildConcurrency: env.BUILD_CONCURRENCY, buildDir: env.BUILD_DIR, api: env.CONTROL_API_URL },
    `worker started (${env.NODE_ENV}); consuming ${QUEUE_NAMES.build}`,
  );
}

start(env).catch((error) => {
  log.fatal({ err: error }, "worker failed to start");
  process.exit(1);
});
