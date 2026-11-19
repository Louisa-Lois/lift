import {
  cursorPage,
  ServiceId,
  UpsertVariablesBody,
  UpsertVariablesResponse,
  Variable,
  VariablesQuery,
} from "@lift/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser } from "../../plugins/auth";
import { requireScope } from "../../plugins/scopes";
import { requireSecretBox, type SecretBox } from "../../services/crypto";
import { publishEvents } from "../../services/events";
import { accessService } from "../../services/services";
import { listVariables, upsertVariables } from "../../services/variables";

const ServiceParams = z.object({ serviceId: ServiceId });

/**
 * BE-09: a service's variables, encrypted at rest. Reading masks values unless an editor asks for
 * `?reveal=true`; writing is a bulk upsert whose changes apply on the next deployment.
 */
export const variableRoutes: FastifyPluginAsyncZod<{ secretBox: SecretBox | null }> = async (
  app,
  { secretBox },
) => {
  app.get(
    "/services/:serviceId/variables",
    {
      schema: {
        summary: "A service's variables, masked unless `?reveal=true` (editors)",
        description:
          "Every variable at once, sorted by key. A masked value is `••••` and its last 4 characters. Revealing with a token needs the admin scope.",
        tags: ["variables"],
        params: ServiceParams,
        querystring: VariablesQuery,
        response: { 200: cursorPage(Variable) },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { reveal } = request.query;
      const { service } = await accessService(
        app.db,
        request.params.serviceId,
        user.id,
        reveal ? "editor" : "viewer",
      );
      if (reveal) requireScope(request, "admin");
      const box = requireSecretBox(secretBox);
      return { data: await listVariables(app.db, box, service.id, reveal), nextCursor: null };
    },
  );

  app.put(
    "/services/:serviceId/variables",
    {
      schema: {
        summary: "Set or delete variables; they apply on the next deployment",
        description:
          "`{ variables: { KEY: value } }` sets a key, and `null` deletes it. PORT and keys starting LIFT_ are Lift's. Answers with every variable, masked.",
        tags: ["variables"],
        params: ServiceParams,
        body: UpsertVariablesBody,
        response: { 200: UpsertVariablesResponse },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { service } = await accessService(app.db, request.params.serviceId, user.id, "editor");
      const box = requireSecretBox(secretBox);
      const event = await upsertVariables(app.db, {
        service,
        secretBox: box,
        changes: request.body.variables,
        actorId: user.id,
      });
      if (event) await publishEvents(app.redis, [event], request.log);
      return {
        variables: await listVariables(app.db, box, service.id, false),
        requiresRedeploy: true as const,
      };
    },
  );
};
