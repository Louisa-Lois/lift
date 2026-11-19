import { User } from "@lift/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { requireUser } from "../../plugins/auth";
import { toUser } from "../../services/users";

/** `GET /api/v1/me`: the signed-in user, or 401. */
export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/me",
    { schema: { summary: "The signed-in user", tags: ["auth"], response: { 200: User } } },
    async (request) => toUser(requireUser(request)),
  );
};
