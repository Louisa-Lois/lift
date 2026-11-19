import { DatabaseId, INTERNAL_ROUTES } from "@lift/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireBearer } from "../../plugins/worker-auth";
import type { SecretBox } from "../../services/crypto";
import { applyDatabaseReport, provisionContext } from "../../services/databases";
import { publishEvents } from "../../services/events";

const Params = z.object({ databaseId: DatabaseId });
/** Fastify's pattern for a contract path: `/databases/:databaseId/…`. */
const pattern = (route: { path: (id: string) => string }) => route.path(":databaseId");

/** The worker's database routes (INF-10), typed by INTERNAL_ROUTES; never in the OpenAPI document. */
export const internalDatabaseRoutes: FastifyPluginAsyncZod<{
  workerToken: string | undefined;
  secretBox: SecretBox | null;
}> = async (app, { workerToken, secretBox }) => {
  requireBearer(app, workerToken, "WORKER_TOKEN");
  const { provisionContext: context, databaseStatus: status } = INTERNAL_ROUTES;

  app.get(
    pattern(context),
    { schema: { hide: true, params: Params, response: { 200: context.response } } },
    async (request) => provisionContext(app.db, secretBox, request.params.databaseId),
  );

  app.post(
    pattern(status),
    {
      schema: { hide: true, params: Params, body: status.body, response: { 200: status.response } },
    },
    async (request) => {
      const { row, events } = await applyDatabaseReport(app.db, {
        databaseId: request.params.databaseId,
        report: request.body,
        secretBox,
      });
      await publishEvents(app.redis, events, request.log);
      return { status: row.status };
    },
  );
};
