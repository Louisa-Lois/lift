import swagger from "@fastify/swagger";
import { API_BASE_PATH } from "@lift/shared";
import type { FastifyInstance } from "fastify";
import { jsonSchemaTransform } from "fastify-type-provider-zod";

/**
 * `/api/v1/openapi.json`, generated from each route's Zod schemas (which come from
 * packages/shared), so the document can't drift from the code. Routes with `hide: true`, like
 * the internal ones, stay out of it.
 */
export function registerOpenApi(app: FastifyInstance): void {
  app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Lift API",
        version: "1.0.0",
        description:
          "The public API behind the dashboard, the lift CLI and the MCP server (docs/contracts.md).",
      },
    },
    transform: jsonSchemaTransform,
  });
  app.get(`${API_BASE_PATH}/openapi.json`, { schema: { hide: true } }, async () => app.swagger());
}
