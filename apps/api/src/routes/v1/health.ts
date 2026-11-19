import { HealthResponse } from "@lift/shared";
import { sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { problem } from "../../lib/problem";
import { withTimeout } from "../../lib/timeout";

/** `GET /api/v1/health`: ok when Postgres and Redis both answer within a second. */
export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/health",
    {
      schema: {
        summary: "Postgres and Redis are reachable",
        tags: ["health"],
        response: { 200: HealthResponse },
      },
    },
    async (request) => {
      const [postgres, redis] = await Promise.allSettled([
        withTimeout(app.db.execute(sql`select 1`), 1_000, "Postgres"),
        withTimeout(app.redis.ping(), 1_000, "Redis"),
      ]);
      const down = [
        postgres.status === "rejected" ? "Postgres" : null,
        redis.status === "rejected" ? "Redis" : null,
      ].filter((name) => name !== null);
      if (down.length > 0) {
        request.log.warn({ postgres: postgres.status, redis: redis.status }, "health check failed");
        throw problem("upstream_unavailable", `${down.join(" and ")} didn't answer.`);
      }
      return { status: "ok" as const };
    },
  );
};
