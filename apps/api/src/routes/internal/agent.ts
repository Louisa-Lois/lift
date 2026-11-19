import { DeploymentId, INTERNAL_ROUTES } from "@lift/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireBearer } from "../../plugins/worker-auth";
import { autofixContext, createDiagnosis } from "../../services/autofix";
import type { SecretBox } from "../../services/crypto";
import type { Github } from "../../services/github";

const Params = z.object({ deploymentId: DeploymentId });

/**
 * The agent service's routes (AI-06), with AGENT_SERVICE_TOKEN, typed by INTERNAL_ROUTES; never in
 * the OpenAPI document. Like the worker's, they 404 for anything that came through Traefik.
 */
export const internalAgentRoutes: FastifyPluginAsyncZod<{
  agentToken: string | undefined;
  github: Github;
  secretBox: SecretBox | null;
  appsDomain: string;
}> = async (app, { agentToken, github, secretBox, appsDomain }) => {
  requireBearer(app, agentToken, "AGENT_SERVICE_TOKEN");
  const { autofixContext: context, diagnoses } = INTERNAL_ROUTES;

  app.get(
    context.path(":deploymentId"),
    { schema: { hide: true, params: Params, response: { 200: context.response } } },
    async (request) => autofixContext(app.db, appsDomain, request.params.deploymentId),
  );

  app.post(
    diagnoses.path(),
    { schema: { hide: true, body: diagnoses.body, response: { 201: diagnoses.response } } },
    async (request, reply) => {
      const diagnosis = await createDiagnosis(
        {
          db: app.db,
          redis: app.redis,
          queues: app.queues,
          log: request.log,
          github,
          secretBox,
          appsDomain,
        },
        request.body,
      );
      reply.code(201);
      return diagnosis;
    },
  );
};
