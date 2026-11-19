import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";

declare module "fastify" {
  interface FastifyInstance {
    /** The control plane's Redis: streams and events. BullMQ opens its own connections. */
    redis: Redis;
  }
}

/** Connects on first use, fails a command fast while Redis is down, and closes with the server. */
export function registerRedis(app: FastifyInstance, url: string): void {
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  // ioredis retries forever while Redis is down; log the outage once, and the recovery.
  let down = false;
  redis.on("error", (error) => {
    if (down) return;
    down = true;
    app.log.warn({ err: error }, "Redis is unreachable; retrying");
  });
  redis.on("ready", () => {
    if (!down) return;
    down = false;
    app.log.info("Redis is reachable again");
  });
  app.decorate("redis", redis);
  app.addHook("onClose", async () => {
    redis.disconnect();
  });
}
