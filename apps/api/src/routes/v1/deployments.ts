import {
  CreateDeploymentBody,
  cursorPage,
  Deployment,
  DeploymentDetail,
  DeploymentId,
  Diagnosis,
  ListQuery,
  ServiceId,
} from "@lift/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { numberCursor } from "../../lib/pagination";
import { problem } from "../../lib/problem";
import { requireUser, triggerFor } from "../../plugins/auth";
import { findDiagnosis } from "../../services/autofix";
import type { SecretBox } from "../../services/crypto";
import {
  accessDeployment,
  cancelDeployment,
  deploymentDetail,
  listDeployments,
  resolveCommit,
  rollbackDeployment,
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
      config: { scope: "deploy" },
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
      // A session deploys as `manual`, a personal token as `cli`; the agent's (`agent`) comes later.
      const row = await startDeployment(
        { db: app.db, redis: app.redis, queues: app.queues, log: request.log },
        { service, trigger: triggerFor(request), commit, actor: { type: "user", id: user.id } },
      );
      if (!row) throw new Error("a manual or CLI deployment is never a duplicate");
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

  app.get(
    "/deployments/:deploymentId/diagnosis",
    {
      schema: {
        summary: "The assistant's diagnosis of a failed deployment (AI-06)",
        description:
          "404 until autofix has written one, a few seconds to a minute after the failure; then what it found and what it did or proposes.",
        tags: ["deployments"],
        params: DeploymentParams,
        response: { 200: Diagnosis },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { deployment } = await accessDeployment(app.db, request.params.deploymentId, user.id);
      const diagnosis = await findDiagnosis(app.db, deployment.id);
      if (!diagnosis) throw problem("not_found", "This deployment has no diagnosis yet.");
      return diagnosis;
    },
  );

  app.post(
    "/deployments/:deploymentId/rollback",
    {
      config: { scope: "deploy" },
      schema: {
        summary: "Roll back: a new deployment running this one's image, with no build",
        description:
          "Answers 202 with it `deploying`. It runs with today's variables and settings. Only a superseded deployment whose image Lift keeps (the service's last 3) can be the target; anything else gets 409.",
        tags: ["deployments"],
        params: DeploymentParams,
        response: { 202: Deployment },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const { deployment } = await accessDeployment(
        app.db,
        request.params.deploymentId,
        user.id,
        "editor",
      );
      const { service } = await accessService(app.db, deployment.serviceId, user.id, "editor");
      const row = await rollbackDeployment(
        { db: app.db, redis: app.redis, queues: app.queues, log: request.log },
        { service, target: deployment, actor: { type: "user", id: user.id } },
      );
      reply.code(202);
      return toDeployment(row);
    },
  );

  app.post(
    "/deployments/:deploymentId/cancel",
    {
      config: { scope: "deploy" },
      schema: {
        summary: "Cancel a deployment while it's queued or building",
        description: "A running build is stopped. What's live keeps running.",
        tags: ["deployments"],
        params: DeploymentParams,
        response: { 200: Deployment },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { deployment } = await accessDeployment(
        app.db,
        request.params.deploymentId,
        user.id,
        "editor",
      );
      const row = await cancelDeployment(
        { db: app.db, redis: app.redis, queues: app.queues, log: request.log },
        { deployment, actor: { type: "user", id: user.id }, by: user.login },
      );
      return toDeployment(row);
    },
  );
};
