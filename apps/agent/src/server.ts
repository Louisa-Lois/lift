import Fastify, { type FastifyInstance } from "fastify";
import type { Env } from "./env";

/**
 * The agent service is internal only: the API calls it with AGENT_SERVICE_TOKEN, and it never sits
 * behind the public router. AI-01 adds `POST /plans`, `POST /chat/:sessionId/messages` and
 * `POST /actions/:id/decision`, plus the token check (docs/prd/03-ai-agent.md).
 */
export function buildServer(env: Pick<Env, "LOG_LEVEL">): FastifyInstance {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie"],
        censor: "[redacted]",
      },
    },
  });

  app.get("/health", async () => ({ status: "ok" as const }));

  return app;
}
