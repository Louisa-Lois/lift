import { Service, ServiceId, UpdateServiceBody } from "@lift/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { enqueueOp } from "../../jobs/enqueue";
import { requireUser } from "../../plugins/auth";
import { publishEvents } from "../../services/events";
import {
  accessService,
  deleteServiceRows,
  serviceViews,
  updateServiceRows,
} from "../../services/services";

const ServiceParams = z.object({ serviceId: ServiceId });

/** BE-05: one service: read, change settings (used from the next deploy on), delete. */
export const serviceRoutes: FastifyPluginAsyncZod<{ appsDomain: string }> = async (
  app,
  { appsDomain },
) => {
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
      return reply.code(204).send();
    },
  );
};
