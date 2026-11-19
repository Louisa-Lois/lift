import { QUEUE_NAMES } from "@lift/shared";
import { Queue } from "bullmq";
import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";

export interface Queues {
  build: Queue;
  deploy: Queue;
  ops: Queue;
}

declare module "fastify" {
  interface FastifyInstance {
    /** BullMQ queues the worker consumes; the API only adds jobs (jobs/enqueue.ts). */
    queues: Queues;
  }
}

/**
 * The worker's three queues on the control plane's Redis (docs/contracts.md, "Worker jobs").
 * `prefix` keeps tests apart from each other and from a running worker.
 */
export function registerQueues(app: FastifyInstance, url: string, prefix = "bull"): void {
  // BullMQ needs its own connection with no per-command retry limit.
  const connection = new Redis(url, { maxRetriesPerRequest: null });
  // Outages are reported by the main Redis client (plugins/redis.ts).
  connection.on("error", () => {});
  const open = (name: string) => {
    const queue = new Queue(name, { connection, prefix });
    queue.on("error", (error) => app.log.warn({ err: error, queue: name }, "queue error"));
    return queue;
  };
  const queues: Queues = {
    build: open(QUEUE_NAMES.build),
    deploy: open(QUEUE_NAMES.deploy),
    ops: open(QUEUE_NAMES.ops),
  };
  app.decorate("queues", queues);
  app.addHook("onClose", async () => {
    await Promise.all(Object.values(queues).map((queue) => queue.close()));
    connection.disconnect();
  });
}
