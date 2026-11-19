import { randomBytes } from "node:crypto";
import cookie from "@fastify/cookie";
import {
  type DeploymentTrigger,
  INTERNAL_BASE_PATH,
  INVITE_ONLY_PROBLEM_TYPE,
  SESSION_COOKIE,
  TOKEN_PREFIXES,
  type TokenScope,
} from "@lift/shared";
import type { FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { type Env, isAllowedLogin } from "../env";
import { problem } from "../lib/problem";
import { deleteSession, findSession, slideSession, type UserRow } from "../services/sessions";
import { findToken, scopeOf, touchToken } from "../services/tokens";

/** How the caller proved who they are: the browser's session cookie, or a personal token. */
export type Credential =
  | { via: "session"; sessionId: string }
  | { via: "token"; tokenId: string; scope: TokenScope };

declare module "fastify" {
  interface FastifyRequest {
    /** The signed-in user, from the lift_session cookie or a personal token; null when neither. */
    user: UserRow | null;
    /** The session's ID (the SHA-256 of the cookie), for logout. */
    sessionId: string | null;
    credential: Credential | null;
    /**
     * Why a request that carried a credential has no user: its login is no longer on
     * ALLOWED_GITHUB_LOGINS, or its token is unknown or revoked.
     */
    signedOutBecause: "invite_only" | "invalid_token" | null;
  }
}

/** httpOnly, SameSite=Lax, and Secure only over https: Traefik terminates TLS in production. */
export function cookieAttributes(env: Pick<Env, "PUBLIC_URL">) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.PUBLIC_URL.startsWith("https://"),
  };
}

/** The `lift_pat_` token in `Authorization: Bearer …`, or null for any other header. */
function personalToken(header: string | undefined): string | null {
  const value = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "")?.[1];
  return value?.startsWith(TOKEN_PREFIXES.personal) ? value : null;
}

/**
 * Puts the caller on `request.user`, from a personal token (`Authorization: Bearer lift_pat_…`)
 * or else the lift_session cookie. A token wins over a cookie. Other bearer values, like the
 * worker's WORKER_TOKEN, are left to the routes that expect them. A login that is no longer
 * invited gets no user: its session is deleted on the spot, so removing someone from
 * ALLOWED_GITHUB_LOGINS signs them out at their next request; its tokens stop working but are
 * kept, so adding the login back restores them.
 */
export const authPlugin = fp<{ env: Env }>(
  async (app, { env }) => {
    // Signs the 10-minute OAuth state cookie. Without SESSION_SECRET (development only), a random
    // secret per process does the job.
    await app.register(cookie, { secret: env.SESSION_SECRET ?? randomBytes(32).toString("hex") });
    app.decorateRequest("user", null);
    app.decorateRequest("sessionId", null);
    app.decorateRequest("credential", null);
    app.decorateRequest("signedOutBecause", null);

    app.addHook("onRequest", async (request, reply) => {
      // The worker's routes check their own token (plugins/worker-auth.ts).
      if (request.url.startsWith(INTERNAL_BASE_PATH)) return;

      const bearer = personalToken(request.headers.authorization);
      if (bearer !== null) {
        const found = await findToken(app.db, bearer);
        if (!found) {
          request.signedOutBecause = "invalid_token";
          return;
        }
        if (!isAllowedLogin(env, found.user.login)) {
          request.signedOutBecause = "invite_only";
          return;
        }
        request.user = found.user;
        request.credential = {
          via: "token",
          tokenId: found.token.id,
          scope: scopeOf(found.token.scopes),
        };
        await touchToken(app.db, found.token);
        return;
      }

      const token = request.cookies[SESSION_COOKIE];
      if (!token) return;
      const session = await findSession(app.db, token);
      if (!session) {
        reply.clearCookie(SESSION_COOKIE, cookieAttributes(env));
        return;
      }
      if (!isAllowedLogin(env, session.user.login)) {
        await deleteSession(app.db, session.id);
        reply.clearCookie(SESSION_COOKIE, cookieAttributes(env));
        request.signedOutBecause = "invite_only";
        return;
      }
      request.user = session.user;
      request.sessionId = session.id;
      request.credential = { via: "session", sessionId: session.id };
      const expiresAt = await slideSession(app.db, session);
      if (expiresAt) {
        reply.setCookie(SESSION_COOKIE, token, { ...cookieAttributes(env), expires: expiresAt });
      }
    });
  },
  { name: "lift-auth" },
);

/** The signed-in user, or a 401 that says why (sign in, a bad token, or invite-only). */
export function requireUser(request: FastifyRequest): UserRow {
  if (request.user) return request.user;
  if (request.signedOutBecause === "invite_only") {
    throw problem("unauthenticated", "Lift is invite-only for now.", {
      type: INVITE_ONLY_PROBLEM_TYPE,
    });
  }
  if (request.signedOutBecause === "invalid_token") {
    throw problem("unauthenticated", "This token isn't valid or was revoked.");
  }
  throw problem("unauthenticated", "Sign in to continue.");
}

/**
 * Who started a deployment, from the credential (docs/prd/01-backend-api.md, "Deployments"): a
 * session deploys as `manual`, a personal token as `cli`.
 */
export function triggerFor(request: FastifyRequest): Extract<DeploymentTrigger, "manual" | "cli"> {
  return request.credential?.via === "token" ? "cli" : "manual";
}
