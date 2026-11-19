import { API_BASE_PATH, type TokenScope } from "@lift/shared";
import type { FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { problem } from "../lib/problem";
import { scopeCovers } from "../services/tokens";
import { requireUser } from "./auth";

declare module "fastify" {
  interface FastifyContextConfig {
    /** Reachable without a session or token (marked public in docs/prd/01-backend-api.md). */
    public?: boolean;
    /** The least scope a personal token needs here: by default read for GET, admin otherwise. */
    scope?: TokenScope;
    /** `false`: the agent service may not call this route, though it only reads. */
    agent?: false;
  }
}

/** The scope a route asks of tokens. */
export function neededScope(request: FastifyRequest): TokenScope {
  const declared = request.routeOptions.config.scope;
  if (declared) return declared;
  return request.method === "GET" || request.method === "HEAD" ? "read" : "admin";
}

/**
 * 403 when the caller is a token without `needed`. The agent service counts as a read token, so
 * it never writes and never reveals a secret through the public API. A session is limited only by
 * its role.
 */
export function requireScope(request: FastifyRequest, needed: TokenScope): void {
  const credential = request.credential;
  if (credential?.via === "agent") {
    if (needed === "read" && request.routeOptions.config.agent !== false) return;
    throw problem("forbidden", "The agent service can only read here, and never secrets.");
  }
  if (credential?.via !== "token" || scopeCovers(credential.scope, needed)) return;
  throw problem("forbidden", `This token's scope is ${credential.scope}; this needs ${needed}.`);
}

/**
 * Deny by default: every `/api/v1` route needs a session or a token unless it is marked
 * `config: { public: true }`, and a token needs the route's scope (the agent service only reads).
 * It runs before the body is parsed, so a caller who isn't signed in learns nothing from
 * validation errors. Handlers still check the caller's role in the project.
 */
export const routeGuard = fp(
  async (app) => {
    app.addHook("onRequest", async (request) => {
      const url = request.routeOptions.url;
      if (!url?.startsWith(API_BASE_PATH) || request.routeOptions.config.public) return;
      requireUser(request);
      requireScope(request, neededScope(request));
    });
  },
  { name: "lift-route-guard", dependencies: ["lift-auth"] },
);
