import { isLiftApiError, PROBLEM_CONTENT_TYPE, type Problem } from "@lift/shared";
import type { FastifyError, FastifyInstance, FastifyReply } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from "fastify-type-provider-zod";
import { withoutQuery } from "../lib/logger";
import { problem, problemForStatus } from "../lib/problem";

function send(reply: FastifyReply, body: Problem): FastifyReply {
  return reply.code(body.status).type(PROBLEM_CONTENT_TYPE).send(body);
}

/** `/repo/owner` → `repo.owner`, the dot path forms use (docs/contracts.md, "API rules"). */
function dotPath(instancePath: string): string {
  return instancePath.replace(/^\//, "").replaceAll("/", ".") || "(root)";
}

/**
 * Every error leaves the API as application/problem+json with a stable `code`. Called on the root
 * instance before any route is registered, so every route inherits it.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (isLiftApiError(error)) {
      // A 5xx problem means something Lift relies on failed (GitHub, collab, the agent): log what
      // the person was told, which names the failing call. Lift writes every detail, never with a
      // token in it; the cause can hold an upstream's raw answer, so it stays out.
      if (error.status >= 500) {
        request.log.warn(
          { problem: { code: error.code, status: error.status, detail: error.detail } },
          "answered with a problem",
        );
      }
      return send(reply, error.toProblem());
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      const fields: Record<string, string> = {};
      for (const issue of error.validation) {
        fields[dotPath(issue.instancePath)] ??= issue.message ?? "invalid";
      }
      const where = error.validationContext ?? "request";
      return send(
        reply,
        problem("validation_failed", `The ${where} doesn't match the schema.`, {
          fields,
        }).toProblem(),
      );
    }

    // A handler answered with a body that breaks its own response schema: our bug, not theirs.
    if (isResponseSerializationError(error)) {
      request.log.error({ err: error }, "response doesn't match its schema");
      return send(reply, problem("internal", "Something went wrong on our side.").toProblem());
    }

    const status = error.statusCode ?? 500;
    if (status < 500) return send(reply, problemForStatus(status, error.message));

    request.log.error({ err: error }, "unhandled error");
    return send(reply, problem("internal", "Something went wrong on our side.").toProblem());
  });

  app.setNotFoundHandler((request, reply) =>
    send(
      reply,
      problem(
        "not_found",
        `No route for ${request.method} ${withoutQuery(request.url)}.`,
      ).toProblem(),
    ),
  );
}
