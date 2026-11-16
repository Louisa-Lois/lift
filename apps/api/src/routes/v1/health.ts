import type { FastifyInstance } from "fastify";

/** `GET /api/v1/health`. BE-01 adds the Postgres and Redis checks. */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok" as const }));
}
