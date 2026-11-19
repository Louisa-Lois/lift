import {
  CreateDeploymentBody,
  cursorPage,
  Deployment,
  DeploymentDetail,
  DeploymentId,
  ListQuery,
  ServiceId,
} from "@lift/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { numberCursor } from "../../lib/pagination";
import { requireUser } from "../../plugins/auth";
import type { SecretBox } from "../../services/crypto";
import {
  accessDeployment,
  deploymentDetail,
  listDeployments,
  resolveCommit,
  startDeployment,
  toDeployment,
} from "../../services/deployments";
import type { Github } from "../../services/github";
import { accessService } from "../../services/services";
import { githubTokenOf } from "../../services/users";
import { ensureWebhook } from "../../services/webhooks";

const ServiceParams = z.object({ serviceId: ServiceId });
const DeploymentParams = z.object({ deploymentId: DeploymentId });

/** BE-06: a service's deployments: list, deploy a commit, and one deployment with its timeline. */
export const deploymentRoutes: FastifyPluginAsyncZod<{
  github: Github;
  secretBox: SecretBox | null;
  publicUrl: string;
}> = async (app, { github, secretBox, publicUrl }) => {
  app.get(
    "/services/:serviceId/deployments",
    {
      schema: {
        summary: "A service's deployments, newest first",
        tags: ["deployments"],
        params: ServiceParams,
        querystring: ListQuery,
        response: { 200: cursorPage(Deployment) },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { service } = await accessService(app.db, request.params.serviceId, user.id);
      const { limit, cursor } = request.query;
      const offset = numberCursor(cursor, 0);
      const rows = await listDeployments(app.db, service.id, { limit: limit + 1, offset });
      return {
        data: rows.slice(0, limit).map(toDeployment),
        nextCursor: rows.length > limit ? String(offset + limit) : null,
      };
    },
  );

  app.post(
    "/services/:serviceId/deployments",
    {
      schema: {
        summary: "Deploy a commit (the branch head unless `commitSha` is given)",
        description:
          "Answers 202 with the queued deployment. An older queued deployment of the service is canceled: newest wins.",
        tags: ["deployments"],
        params: ServiceParams,
        body: CreateDeploymentBody,
        response: { 202: Deployment },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const { service } = await accessService(app.db, request.params.serviceId, user.id, "editor");
      const token = githubTokenOf(secretBox, user);
      // Services made before push webhooks existed get theirs on their next deploy.
      await ensureWebhook(
        { db: app.db, github, secretBox, publicUrl, log: request.log },
        service,
        token,
      );
      const commit = await resolveCommit(github, token, service, request.body.commitSha);
      // A session deploys as `manual`; API tokens (`cli`) and the agent's (`agent`) come later.
      const row = await startDeployment(
        { db: app.db, redis: app.redis, queues: app.queues, log: request.log },
        { service, trigger: "manual", commit, actor: { type: "user", id: user.id } },
      );
      if (!row) throw new Error("a manual deployment is never a duplicate");
      reply.code(202);
      return toDeployment(row);
    },
  );

  app.get(
    "/deployments/:deploymentId",
    {
      schema: {
        summary: "A deployment with its timeline, oldest step first",
        tags: ["deployments"],
        params: DeploymentParams,
        response: { 200: DeploymentDetail },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { deployment } = await accessDeployment(app.db, request.params.deploymentId, user.id);
      return deploymentDetail(app.db, deployment);
    },
  );
};
