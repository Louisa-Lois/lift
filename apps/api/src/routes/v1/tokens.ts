import {
  ApiToken,
  ApiTokenId,
  CreatedApiToken,
  CreateTokenBody,
  cursorPage,
  ListQuery,
} from "@lift/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { numberCursor } from "../../lib/pagination";
import { problem } from "../../lib/problem";
import { requireUser } from "../../plugins/auth";
import { createToken, listTokens, revokeToken, toApiToken } from "../../services/tokens";

const TokenParams = z.object({ tokenId: ApiTokenId });

/**
 * BE-14: the caller's personal tokens (`lift_pat_…`) for the CLI, the MCP server and scripts.
 * Creating and revoking need a session or an admin token (the default scope for writes).
 */
export const tokenRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/tokens",
    {
      schema: {
        summary: "Your personal tokens, newest first, revoked ones included",
        description: "A token's plaintext is never returned after it is created.",
        tags: ["tokens"],
        querystring: ListQuery,
        response: { 200: cursorPage(ApiToken) },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { limit, cursor } = request.query;
      const offset = numberCursor(cursor, 0);
      const rows = await listTokens(app.db, user.id, { limit: limit + 1, offset });
      return {
        data: rows.slice(0, limit).map(toApiToken),
        nextCursor: rows.length > limit ? String(offset + limit) : null,
      };
    },
  );

  app.post(
    "/tokens",
    {
      schema: {
        summary: "Create a personal token; its plaintext is in this answer only",
        description:
          "Scopes are levels: read, deploy (also deploy, roll back, cancel, restart) and admin (everything your role allows).",
        tags: ["tokens"],
        body: CreateTokenBody,
        response: { 201: CreatedApiToken },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      if (request.body.projectId !== undefined) {
        throw problem("validation_failed", "Tokens for one project aren't available yet.", {
          fields: { projectId: "Leave this out: a token acts on all your projects for now" },
        });
      }
      const created = await createToken(app.db, {
        userId: user.id,
        name: request.body.name,
        scopes: request.body.scopes,
      });
      request.log.info({ tokenId: created.id, scopes: created.scopes }, "personal token created");
      reply.code(201);
      return created;
    },
  );

  app.delete(
    "/tokens/:tokenId",
    {
      schema: {
        summary: "Revoke one of your tokens; it stops working at once",
        tags: ["tokens"],
        params: TokenParams,
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      if (!(await revokeToken(app.db, user.id, request.params.tokenId))) {
        throw problem("not_found", `No token ${request.params.tokenId}.`);
      }
      request.log.info({ tokenId: request.params.tokenId }, "personal token revoked");
      return reply.code(204).send();
    },
  );
};
