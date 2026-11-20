import {
  API_BASE_PATH,
  DatabaseId,
  DeploymentId,
  ProjectId,
  type ProjectRole,
  ServiceId,
  type TokenScope,
} from "@lift/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { problem } from "../lib/problem";
import { accessProject } from "../services/access";
import { accessDatabase } from "../services/databases";
import { accessDeployment } from "../services/deployments";
import { accessService } from "../services/services";
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
    /**
     * The least project role this route needs, checked from its path's project, service,
     * deployment or database ID: by default viewer for GET, editor otherwise.
     */
    role?: ProjectRole;
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

/** The project role a route asks for: its `config.role`, else viewer for GET and editor otherwise. */
export function neededRole(request: FastifyRequest): ProjectRole {
  const declared = request.routeOptions.config.role;
  if (declared) return declared;
  return request.method === "GET" || request.method === "HEAD" ? "viewer" : "editor";
}

/**
 * Checks the caller's role in the project a route's path points at, through its first resource
 * ID. A malformed ID is left to validation (400), and a route with none is the handler's to check.
 */
async function requireRole(
  db: FastifyInstance["db"],
  params: unknown,
  userId: string,
  needed: ProjectRole,
): Promise<void> {
  const ids = (params ?? {}) as Record<string, unknown>;
  if (ProjectId.safeParse(ids.projectId).success) {
    await accessProject(db, ids.projectId as string, userId, needed);
  } else if (ServiceId.safeParse(ids.serviceId).success) {
    await accessService(db, ids.serviceId as string, userId, needed);
  } else if (DeploymentId.safeParse(ids.deploymentId).success) {
    await accessDeployment(db, ids.deploymentId as string, userId, needed);
  } else if (DatabaseId.safeParse(ids.databaseId).success) {
    await accessDatabase(db, ids.databaseId as string, userId, needed);
  }
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
    // BE-15: the caller's role in the route's project, before the body is validated, so a viewer
    // gets 403 on every write whatever it sends. Handlers still check, and load what they need.
    app.addHook("preValidation", async (request) => {
      const url = request.routeOptions.url;
      if (!url?.startsWith(API_BASE_PATH) || request.routeOptions.config.public) return;
      const user = request.user;
      if (!user) return;
      await requireRole(app.db, request.params, user.id, neededRole(request));
    });
  },
  { name: "lift-route-guard", dependencies: ["lift-auth"] },
);
