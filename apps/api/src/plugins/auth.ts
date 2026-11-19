import { randomBytes } from "node:crypto";
import cookie from "@fastify/cookie";
import {
  ACT_AS_HEADER,
  type DeploymentTrigger,
  INTERNAL_BASE_PATH,
  INVITE_ONLY_PROBLEM_TYPE,
  SESSION_COOKIE,
  TOKEN_PREFIXES,
  type TokenScope,
  UserId,
} from "@lift/shared";
import type { FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { type Env, isAllowedLogin } from "../env";
import { problem } from "../lib/problem";
import { deleteSession, findSession, slideSession, type UserRow } from "../services/sessions";
import { findToken, scopeOf, touchToken } from "../services/tokens";
import { findUserById } from "../services/users";
import { cameThroughProxy, sameSecret } from "./worker-auth";

/**
 * How the caller proved who they are: the browser's session cookie, a personal token, or the
 * agent service's token acting as one user (it may only read: plugins/scopes.ts).
 */
export type Credential =
  | { via: "session"; sessionId: string }
  | { via: "token"; tokenId: string; scope: TokenScope }
  | { via: "agent"; userId: string };

declare module "fastify" {
  interface FastifyRequest {
    /** The signed-in user, from the lift_session cookie or a personal token; null when neither. */
    user: UserRow | null;
    /** The session's ID (the SHA-256 of the cookie), for logout. */
    sessionId: string | null;
    credential: Credential | null;
    /**
     * Why a request that carried a credential has no user: its login is no longer on
     * ALLOWED_GITHUB_LOGINS, its token is unknown or revoked, or it sent X-Lift-Act-As without
     * being the agent service, or naming no Lift user.
     */
    signedOutBecause: "invite_only" | "invalid_token" | "bad_act_as" | null;
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

/** The value of `Authorization: Bearer …`, or null. */
function bearerOf(header: string | undefined): string | null {
  return /^Bearer\s+(\S+)\s*$/i.exec(header ?? "")?.[1] ?? null;
}

/**
 * Puts the caller on `request.user`, from a personal token (`Authorization: Bearer lift_pat_…`),
 * the agent service's token (`lift_svc_…` with `X-Lift-Act-As: usr_…`), or else the
 * lift_session cookie. A token wins over a cookie. Other bearer values, like the worker's
 * WORKER_TOKEN, are left to the routes that expect them. A login that is no longer invited gets
 * no user: its session is deleted on the spot, so removing someone from ALLOWED_GITHUB_LOGINS
 * signs them out at their next request; its tokens stop working but are kept, so adding the login
 * back restores them. The agent acting as that login stops working the same way.
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

    /**
     * The agent service (AI-02): AGENT_SERVICE_TOKEN, compared in constant time, on a request
     * that came straight from the internal network (never through Traefik, so a leaked token is
     * useless from the internet), acting as the user it names.
     */
    async function signInAgent(request: FastifyRequest, bearer: string): Promise<void> {
      const expected = env.AGENT_SERVICE_TOKEN;
      if (!expected || cameThroughProxy(request) || !sameSecret(bearer, expected)) {
        request.signedOutBecause = "invalid_token";
        return;
      }
      const actAs = UserId.safeParse(request.headers[ACT_AS_HEADER.toLowerCase()]);
      const user = actAs.success ? await findUserById(app.db, actAs.data) : null;
      if (!user) {
        request.signedOutBecause = "bad_act_as";
        return;
      }
      if (!isAllowedLogin(env, user.login)) {
        request.signedOutBecause = "invite_only";
        return;
      }
      request.user = user;
      request.credential = { via: "agent", userId: user.id };
    }

    app.addHook("onRequest", async (request, reply) => {
      // The worker's routes check their own token (plugins/worker-auth.ts).
      if (request.url.startsWith(INTERNAL_BASE_PATH)) return;

      const bearer = bearerOf(request.headers.authorization);
      if (bearer?.startsWith(TOKEN_PREFIXES.service)) {
        await signInAgent(request, bearer);
        return;
      }
      if (request.headers[ACT_AS_HEADER.toLowerCase()] !== undefined) {
        // Only the agent service may act as someone else.
        request.signedOutBecause = "bad_act_as";
        return;
      }
      if (bearer?.startsWith(TOKEN_PREFIXES.personal)) {
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
  if (request.signedOutBecause === "bad_act_as") {
    throw problem(
      "unauthenticated",
      `Only the agent service may send ${ACT_AS_HEADER}, and it must name a Lift user's ID.`,
    );
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
