import { randomBytes } from "node:crypto";
import cookie from "@fastify/cookie";
import { INVITE_ONLY_PROBLEM_TYPE, SESSION_COOKIE } from "@lift/shared";
import type { FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { type Env, isAllowedLogin } from "../env";
import { problem } from "../lib/problem";
import { deleteSession, findSession, slideSession, type UserRow } from "../services/sessions";

declare module "fastify" {
  interface FastifyRequest {
    /** The signed-in user, from the lift_session cookie; null when signed out. */
    user: UserRow | null;
    /** The session's ID (the SHA-256 of the cookie), for logout. */
    sessionId: string | null;
    /** Set when the cookie belonged to a login that is no longer on ALLOWED_GITHUB_LOGINS. */
    signedOutBecause: "invite_only" | null;
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

/**
 * Reads the lift_session cookie on every request and puts its user on `request.user`. A session
 * whose login is no longer invited is deleted on the spot, so removing someone from
 * ALLOWED_GITHUB_LOGINS signs them out at their next request.
 */
export const authPlugin = fp<{ env: Env }>(
  async (app, { env }) => {
    // Signs the 10-minute OAuth state cookie. Without SESSION_SECRET (development only), a random
    // secret per process does the job.
    await app.register(cookie, { secret: env.SESSION_SECRET ?? randomBytes(32).toString("hex") });
    app.decorateRequest("user", null);
    app.decorateRequest("sessionId", null);
    app.decorateRequest("signedOutBecause", null);

    app.addHook("onRequest", async (request, reply) => {
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
      const expiresAt = await slideSession(app.db, session);
      if (expiresAt) {
        reply.setCookie(SESSION_COOKIE, token, { ...cookieAttributes(env), expires: expiresAt });
      }
    });
  },
  { name: "lift-auth" },
);

/** The signed-in user, or a 401 that says why (sign in, or invite-only). */
export function requireUser(request: FastifyRequest): UserRow {
  if (request.user) return request.user;
  if (request.signedOutBecause === "invite_only") {
    throw problem("unauthenticated", "Lift is invite-only for now.", {
      type: INVITE_ONLY_PROBLEM_TYPE,
    });
  }
  throw problem("unauthenticated", "Sign in to continue.");
}
