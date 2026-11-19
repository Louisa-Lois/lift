import { DeploymentId, INTERNAL_ROUTES } from "@lift/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireBearer } from "../../plugins/worker-auth";
import type { SecretBox } from "../../services/crypto";
import { applyReport } from "../../services/deployments";
import { buildContext, runtimeEnv } from "../../services/runtime";

const Params = z.object({ deploymentId: DeploymentId });
/** Fastify's pattern for a contract path: `/deployments/:deploymentId/…`. */
const pattern = (route: { path: (id: string) => string }) => route.path(":deploymentId");

/**
 * The worker's deployment routes (docs/contracts.md, "Worker jobs"), typed by INTERNAL_ROUTES.
 * Registered under INTERNAL_BASE_PATH and left out of the OpenAPI document.
 */
export const internalDeploymentRoutes: FastifyPluginAsyncZod<{
  workerToken: string | undefined;
  appsDomain: string;
  secretBox: SecretBox | null;
}> = async (app, { workerToken, appsDomain, secretBox }) => {
  requireBearer(app, workerToken, "WORKER_TOKEN");

  const { buildContext: build, runtimeEnv: runtime, deploymentStatus: status } = INTERNAL_ROUTES;

  app.get(
    pattern(build),
    { schema: { hide: true, params: Params, response: { 200: build.response } } },
    async (request) => buildContext(app.db, secretBox, request.params.deploymentId),
  );

  app.get(
    pattern(runtime),
    { schema: { hide: true, params: Params, response: { 200: runtime.response } } },
    async (request) => runtimeEnv(app.db, secretBox, appsDomain, request.params.deploymentId),
  );

  app.post(
    pattern(status),
    {
      schema: {
        hide: true,
        params: Params,
        body: status.body,
        response: { 200: status.response },
      },
    },
    async (request) => {
      const row = await applyReport(
        { db: app.db, redis: app.redis, queues: app.queues, log: request.log },
        request.params.deploymentId,
        request.body,
      );
      return { status: row.status };
    },
  );
};
