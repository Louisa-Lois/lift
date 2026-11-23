import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  API_BASE_PATH,
  CreateSessionResponse,
  GithubSignInQuery,
  RedirectPath,
  SESSION_COOKIE,
} from "@lift/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { type Env, isAllowedLogin } from "../../env";
import { problem } from "../../lib/problem";
import { cookieAttributes, requireUser } from "../../plugins/auth";
import type { SecretBox } from "../../services/crypto";
import type { Github, GithubProfile } from "../../services/github";
import { createSession, deleteSession } from "../../services/sessions";
import { toUser, upsertGithubUser } from "../../services/users";

/** Holds the OAuth `state` and where to go afterwards, signed, for 10 minutes. */
const STATE_COOKIE = "lift_oauth";
const STATE_MAX_AGE_SECONDS = 10 * 60;
const SavedState = z.object({ state: z.string().min(16), next: RedirectPath.nullable() });

/** What GitHub sends to the callback; other parameters are ignored. */
const CallbackQuery = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface AuthRoutesOptions {
  env: Env;
  github: Github;
  /** Null when ENCRYPTION_KEY isn't set (development); sign-in then says it isn't configured. */
  secretBox: SecretBox | null;
}

/**
 * GitHub sign-in (docs/prd/01-backend-api.md, "Sign-in"), invite-only: a login missing from
 * ALLOWED_GITHUB_LOGINS gets no account and no session, its GitHub grant is revoked, and the
 * dashboard says "Lift is invite-only for now". Every outcome is a redirect to the dashboard.
 */
export const authRoutes: FastifyPluginAsyncZod<AuthRoutesOptions> = async (
  app,
  { env, github, secretBox },
) => {
  const site = env.PUBLIC_URL.replace(/\/+$/, "");
  const callbackUrl = `${site}${API_BASE_PATH}/auth/github/callback`;
  const stateCookie = { ...cookieAttributes(env), path: `${API_BASE_PATH}/auth/github` };
  /** The dashboard's /login, with an error it explains. */
  const loginPage = (error: string, extra: Record<string, string> = {}) =>
    `${site}/login?${new URLSearchParams({ error, ...extra })}`;

  app.get(
    "/auth/github/start",
    {
      config: { public: true },
      schema: {
        summary: "Sign in with GitHub: redirects to GitHub, then back to the callback",
        tags: ["auth"],
        querystring: GithubSignInQuery,
      },
    },
    async (request, reply) => {
      if (!github.configured || !secretBox) return reply.redirect(loginPage("config"));
      const state = randomBytes(24).toString("base64url");
      reply.setCookie(STATE_COOKIE, JSON.stringify({ state, next: request.query.next ?? null }), {
        ...stateCookie,
        maxAge: STATE_MAX_AGE_SECONDS,
        signed: true,
      });
      return reply.redirect(github.authorizeUrl(callbackUrl, state));
    },
  );

  app.get(
    "/auth/github/callback",
    {
      config: { public: true },
      schema: {
        summary: "GitHub's OAuth callback: signs in and redirects to the dashboard",
        tags: ["auth"],
        querystring: CallbackQuery,
      },
    },
    async (request, reply) => {
      const raw = request.cookies[STATE_COOKIE];
      const unsigned = raw ? request.unsignCookie(raw) : null;
      const saved = unsigned?.valid ? parseSavedState(unsigned.value) : null;
      reply.clearCookie(STATE_COOKIE, stateCookie);

      const { code, state, error } = request.query;
      if (error) return reply.redirect(loginPage(error === "access_denied" ? "denied" : "github"));
      if (!saved || !code || !state || !sameString(saved.state, state)) {
        return reply.redirect(loginPage("state"));
      }
      if (!github.configured || !secretBox) return reply.redirect(loginPage("config"));

      let token: string;
      let profile: GithubProfile;
      try {
        token = await github.exchangeCode(code, callbackUrl);
        profile = await github.getProfile(token);
      } catch (failure) {
        request.log.warn({ err: failure }, "GitHub sign-in failed");
        return reply.redirect(loginPage("github"));
      }

      if (!isAllowedLogin(env, profile.login)) {
        request.log.info({ login: profile.login }, "sign-in refused: not on ALLOWED_GITHUB_LOGINS");
        await github
          .revokeGrant(token)
          .catch((failure) =>
            request.log.warn({ err: failure }, "couldn't revoke the GitHub grant"),
          );
        return reply.redirect(loginPage("invite_only", { login: profile.login }));
      }

      const email = await github.getPrimaryEmail(token).catch(() => null);
      const user = await upsertGithubUser(
        app.db,
        {
          githubId: profile.id,
          login: profile.login,
          name: profile.name,
          email,
          avatarUrl: profile.avatar_url,
        },
        secretBox.encrypt(token),
      );
      const session = await createSession(app.db, {
        userId: user.id,
        ip: request.ip ?? null,
        userAgent: request.headers["user-agent"] ?? null,
      });
      reply.setCookie(SESSION_COOKIE, session.token, {
        ...cookieAttributes(env),
        expires: session.expiresAt,
      });
      return reply.redirect(`${site}${saved.next ?? "/projects"}`);
    },
  );

  app.post(
    "/auth/logout",
    {
      // Public: signing out works with an expired session, and with a token it revokes nothing.
      config: { public: true },
      schema: { summary: "Sign out: ends this session", tags: ["auth"] },
    },
    async (request, reply) => {
      if (request.sessionId) await deleteSession(app.db, request.sessionId);
      reply.clearCookie(SESSION_COOKIE, cookieAttributes(env));
      return reply.code(204).send();
    },
  );

  app.post(
    "/auth/session",
    {
      // Not public: the route guard asks a token for admin scope, the default for writes, so a
      // read or deploy token can't turn itself into a session that may do everything.
      schema: {
        summary: "Swap a personal token (admin scope) for a browser session, for end-to-end tests",
        description:
          "Sets lift_session like GitHub sign-in does. Only a personal token may call it; a session gets 403.",
        tags: ["auth"],
        response: { 200: CreateSessionResponse },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      if (request.credential?.via !== "token") {
        throw problem("forbidden", "Send a personal token: this route turns one into a session.");
      }
      const session = await createSession(app.db, {
        userId: user.id,
        ip: request.ip ?? null,
        userAgent: request.headers["user-agent"] ?? null,
      });
      reply.setCookie(SESSION_COOKIE, session.token, {
        ...cookieAttributes(env),
        expires: session.expiresAt,
      });
      request.log.info({ tokenId: request.credential.tokenId }, "session created from a token");
      return { user: toUser(user), expiresAt: session.expiresAt.toISOString() };
    },
  );
};

function parseSavedState(value: string): z.infer<typeof SavedState> | null {
  try {
    const parsed = SavedState.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
