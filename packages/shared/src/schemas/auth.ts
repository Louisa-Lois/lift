import { z } from "zod";
import { CliLoginStatus } from "../enums";
import { RedirectPath, Timestamp } from "./common";
import { PersonalToken } from "./token";
import { User } from "./user";

/** The browser session cookie (httpOnly, Secure, SameSite=Lax, 14 days, sliding). */
export const SESSION_COOKIE = "lift_session";

/**
 * Sent by the agent service with its `lift_svc_` token to act as a user. The API accepts it only
 * with that token.
 */
export const ACT_AS_HEADER = "X-Lift-Act-As";

/** Sent by the API to the agent service with the user's ID. */
export const AGENT_USER_HEADER = "X-Lift-User";

/** `GET /auth/github/start?next=/p/…`: where to land after sign-in (default `/`). */
export const GithubSignInQuery = z.object({ next: RedirectPath.optional() });
export type GithubSignInQuery = z.infer<typeof GithubSignInQuery>;

/** `POST /auth/cli` (no body): starts a CLI login. */
export const StartCliLoginResponse = z.object({
  code: z.string().min(4).max(32),
  verifyUrl: z.url(),
  pollSecret: z.string().min(16),
  expiresAt: Timestamp,
});
export type StartCliLoginResponse = z.infer<typeof StartCliLoginResponse>;

/**
 * `GET /auth/cli/:code`, polled by the CLI with `Authorization: Bearer {pollSecret}`. The secret
 * goes in a header because query strings end up in access logs.
 */
export const PollCliLoginResponse = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("approved"), token: PersonalToken }),
  z.object({ status: z.literal("denied") }),
  z.object({ status: z.literal("expired") }),
]);
export type PollCliLoginResponse = z.infer<typeof PollCliLoginResponse>;

/** `POST /auth/cli/:code/approve` and `POST /auth/cli/:code/deny` (no body), by a signed-in user. */
export const CliLoginDecisionResponse = z.object({
  code: z.string().min(4).max(32),
  status: CliLoginStatus,
});
export type CliLoginDecisionResponse = z.infer<typeof CliLoginDecisionResponse>;

/**
 * `POST /auth/session` (no body, bearer token): sets `lift_session` on the caller. Works for
 * end-to-end tests; `lift open --dashboard` will need a one-time URL instead (not in v1).
 */
export const CreateSessionResponse = z.object({ user: User, expiresAt: Timestamp });
export type CreateSessionResponse = z.infer<typeof CreateSessionResponse>;
