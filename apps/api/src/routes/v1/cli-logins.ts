import {
  CliLoginDecisionResponse,
  PollCliLoginResponse,
  StartCliLoginResponse,
} from "@lift/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { type Env, isAllowedLogin } from "../../env";
import { problem } from "../../lib/problem";
import { bearerOf, requireDashboardOrigin, requireUser } from "../../plugins/auth";
import {
  cliLoginStartLimiter,
  decideCliLogin,
  pollCliLogin,
  startCliLogin,
} from "../../services/cli-logins";

const CodeParams = z.object({ code: StartCliLoginResponse.shape.code });

/** What the dashboard says when a code can't be decided any more. */
const ALREADY: Record<string, string> = {
  expired: "This code expired. Run `lift login` again.",
  approved: "This login was already approved.",
  denied: "This login was already denied.",
};

export interface CliLoginRoutesOptions {
  env: Env;
}

/**
 * BE-14: `lift login` through the browser. The CLI starts a login and opens `/cli-auth?code=…`;
 * the user, signed in to the dashboard, approves or denies the code; the CLI polls with its poll
 * secret and gets a new personal token, once.
 */
export const cliLoginRoutes: FastifyPluginAsyncZod<CliLoginRoutesOptions> = async (
  app,
  { env },
) => {
  const allowStart = cliLoginStartLimiter();

  app.post(
    "/auth/cli",
    {
      config: { public: true },
      schema: {
        summary: "Start a CLI login: a code to approve in the dashboard, and a secret to poll with",
        description: "The code lasts 10 minutes. The poll secret is in this answer only.",
        tags: ["auth"],
        response: { 201: StartCliLoginResponse },
      },
    },
    async (_request, reply) => {
      if (!allowStart()) {
        throw problem("rate_limited", "Too many CLI logins started this minute. Try again soon.");
      }
      const started = await startCliLogin(app.db, env.PUBLIC_URL);
      reply.code(201);
      return started;
    },
  );

  app.get(
    "/auth/cli/:code",
    {
      config: { public: true },
      schema: {
        summary: "Poll a CLI login, with `Authorization: Bearer {pollSecret}`",
        description:
          "Pending until the user decides; approved comes with a new admin token, once. An unknown code and a wrong or missing secret both get 404.",
        tags: ["auth"],
        params: CodeParams,
        response: { 200: PollCliLoginResponse },
      },
    },
    async (request) => {
      const answer = await pollCliLogin(app.db, {
        code: request.params.code,
        pollSecret: bearerOf(request.headers.authorization),
        isAllowed: (login) => isAllowedLogin(env, login),
      });
      if (!answer) {
        throw problem(
          "not_found",
          "No CLI login has this code and secret. Run `lift login` again.",
        );
      }
      if (answer.status === "approved") {
        request.log.info({ cliLogin: request.params.code }, "CLI login collected its token");
      }
      return answer;
    },
  );

  for (const [action, status] of [
    ["approve", "approved"],
    ["deny", "denied"],
  ] as const) {
    app.post(
      `/auth/cli/:code/${action}`,
      {
        schema: {
          summary:
            action === "approve"
              ? "Approve a CLI login: that CLI signs in as you"
              : "Deny a CLI login",
          description: "Only from the dashboard, signed in: tokens and other sites get 403.",
          tags: ["auth"],
          params: CodeParams,
          response: { 200: CliLoginDecisionResponse },
        },
      },
      async (request) => {
        const user = requireUser(request);
        if (request.credential?.via !== "session") {
          throw problem("forbidden", "Approve or deny CLI logins in the Lift dashboard.");
        }
        requireDashboardOrigin(request, env);
        const result = await decideCliLogin(app.db, {
          code: request.params.code,
          userId: user.id,
          status,
        });
        if (result.kind === "not_found") {
          throw problem("not_found", "No CLI login has this code. Run `lift login` again.");
        }
        if (result.kind === "already") {
          throw problem("conflict", ALREADY[result.status] ?? "This code can't be used any more.");
        }
        request.log.info({ cliLogin: result.code, status }, `CLI login ${status}`);
        return { code: result.code, status: result.status };
      },
    );
  }
};
