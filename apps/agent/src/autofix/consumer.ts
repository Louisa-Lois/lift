import { JOBS, QUEUE_NAMES } from "@lift/shared";
import { Worker } from "bullmq";
import type { FastifyBaseLogger } from "fastify";
import { Redis } from "ioredis";

/**
 * Consumes `lift-agent` (AI-06): the API queues `autofix` with a failed deployment's ID. Two jobs
 * run at once. A job that throws is logged and dropped; the deployment page stops waiting for its
 * diagnosis after a few minutes.
 */
export function startAutofixConsumer(options: {
  redisUrl: string;
  run: (deploymentId: string) => Promise<unknown>;
  log: FastifyBaseLogger;
  /** BullMQ key prefix: the API's default, or a test's own. */
  prefix?: string;
}): { close(): Promise<void> } {
  // BullMQ needs its own connection with no per-command retry limit.
  const connection = new Redis(options.redisUrl, { maxRetriesPerRequest: null });
  connection.on("error", () => {});
  const worker = new Worker(
    QUEUE_NAMES.agent,
    async (job) => {
      if (job.name !== JOBS.autofix.name) return;
      const { deploymentId } = JOBS.autofix.payload.parse(job.data);
      await options.run(deploymentId);
    },
    { connection, concurrency: 2, ...(options.prefix ? { prefix: options.prefix } : {}) },
  );
  worker.on("failed", (job, error) =>
    options.log.error({ err: error, jobId: job?.id }, "an autofix job failed"),
  );
  worker.on("error", (error) => options.log.warn({ err: error }, "the autofix queue errored"));
  return {
    async close() {
      await worker.close();
      connection.disconnect();
    },
  };
}
