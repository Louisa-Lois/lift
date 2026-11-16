import { API_BASE_PATH } from "@lift/shared";
import Fastify, { type FastifyInstance } from "fastify";
import type { Env } from "./env";
import { healthRoutes } from "./routes/v1/health";

/**
 * Builds the API without starting it, so tests can call it with `app.inject()`.
 * BE-01 registers the plugins listed in docs/prd/01-backend-api.md (auth, db, redis, queues,
 * errors, rate limits, OpenAPI, SSE); each resource gets one file in routes/v1.
 */
export function buildServer(env: Pick<Env, "LOG_LEVEL">): FastifyInstance {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Never log credentials. BE-01 extends this list as routes start handling secrets.
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
        censor: "[redacted]",
      },
    },
  });

  app.register(healthRoutes, { prefix: API_BASE_PATH });

  return app;
}
