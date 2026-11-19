import { Service, ServiceId, UpdateServiceBody } from "@lift/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { enqueueOp } from "../../jobs/enqueue";
import { requireUser } from "../../plugins/auth";
import type { SecretBox } from "../../services/crypto";
import { restartService } from "../../services/deployments";
import { publishEvents } from "../../services/events";
import type { Github } from "../../services/github";
import {
  accessService,
  deleteServiceRows,
  serviceViews,
  updateServiceRows,
} from "../../services/services";
import { githubTokenOf } from "../../services/users";
import { removeWebhook } from "../../services/webhooks";

const ServiceParams = z.object({ serviceId: ServiceId });

/** BE-05: one service: read, change settings (used from the next deploy on), delete. */
export const serviceRoutes: FastifyPluginAsyncZod<{
  appsDomain: string;
  github: Github;
  secretBox: SecretBox | null;
  publicUrl: string;
}> = async (app, { appsDomain, github, secretBox, publicUrl }) => {
  app.get(
    "/services/:serviceId",
    {
      schema: {
        summary: "A service, with its latest and active deployment",
        tags: ["services"],
        params: ServiceParams,
        response: { 200: Service },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { service } = await accessService(app.db, request.params.serviceId, user.id);
      const [view] = await serviceViews(app.db, [service], appsDomain);
      return view as Service;
    },
  );

  app.patch(
    "/services/:serviceId",
    {
      schema: {
        summary: "Change a service's settings; they apply on the next deploy",
        tags: ["services"],
        params: ServiceParams,
        body: UpdateServiceBody,
        response: { 200: Service },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { service } = await accessService(app.db, request.params.serviceId, user.id, "editor");
      const { view, event } = await updateServiceRows(app.db, {
        service,
        actorId: user.id,
        patch: request.body,
        appsDomain,
      });
      await publishEvents(app.redis, [event], request.log);
      return view;
    },
  );

  app.post(
    "/services/:serviceId/restart",
    {
      config: { scope: "deploy" },
      schema: {
        summary: "Restart the running container: same image and variables",
        description:
          "Answers 202; the worker restarts it, so it's down for a few seconds. Variable changes need a deploy. 409 when nothing is running.",
        tags: ["services"],
        params: ServiceParams,
        response: { 202: Service },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const { service } = await accessService(app.db, request.params.serviceId, user.id, "editor");
      const [view] = (await serviceViews(app.db, [service], appsDomain)) as Service[];
      if (!view) throw new Error("no view of the service");
      await restartService(
        { db: app.db, redis: app.redis, queues: app.queues, log: request.log },
        { service, view, actor: { type: "user", id: user.id } },
      );
      reply.code(202);
      return view;
    },
  );

  app.delete(
    "/services/:serviceId",
    {
      schema: {
        summary: "Delete a service; the worker removes its containers",
        tags: ["services"],
        params: ServiceParams,
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const { service } = await accessService(app.db, request.params.serviceId, user.id, "editor");
      const event = await deleteServiceRows(app.db, { service, actorId: user.id, appsDomain });
      await publishEvents(app.redis, [event], request.log);
      await enqueueOp(app.queues, {
        op: "remove_service",
        serviceId: service.id,
        projectId: service.projectId,
      });
      if (service.webhookId !== null) {
        await removeWebhook(
          { db: app.db, github, secretBox, publicUrl, log: request.log },
          service,
          githubTokenOf(secretBox, user),
        );
      }
      return reply.code(204).send();
    },
  );
};
