import { z } from "zod";
import { TokenScope } from "../enums";
import { ApiTokenId, ProjectId, UserId } from "../ids";
import { ResourceName, Timestamp } from "./common";

/**
 * Token formats. Both are the prefix plus 32 base64url characters, the format `pnpm env:init`
 * already uses for AGENT_SERVICE_TOKEN.
 */
export const TOKEN_PREFIXES = { personal: "lift_pat_", service: "lift_svc_" } as const;
export const PERSONAL_TOKEN_PATTERN = /^lift_pat_[A-Za-z0-9_-]{32}$/;
export const SERVICE_TOKEN_PATTERN = /^lift_svc_[A-Za-z0-9_-]{32}$/;
/** How many leading characters of a token are stored and shown, e.g. `lift_pat_x7Q`. */
export const TOKEN_DISPLAY_PREFIX_LENGTH = 12;

export const PersonalToken = z
  .string()
  .regex(PERSONAL_TOKEN_PATTERN, "Expected a personal token: lift_pat_ and 32 more characters");

/** `GET /tokens`. The token itself is never returned after it is created. */
export const ApiToken = z.object({
  id: ApiTokenId,
  userId: UserId,
  name: ResourceName,
  prefix: z.string().startsWith(TOKEN_PREFIXES.personal),
  scopes: z.array(TokenScope).min(1),
  projectId: ProjectId.nullable(),
  lastUsedAt: Timestamp.nullable(),
  revokedAt: Timestamp.nullable(),
  createdAt: Timestamp,
});
export type ApiToken = z.infer<typeof ApiToken>;

/** `POST /tokens`. */
export const CreateTokenBody = z.strictObject({
  name: ResourceName,
  scopes: z.array(TokenScope).min(1),
  projectId: ProjectId.optional(),
});
export type CreateTokenBody = z.infer<typeof CreateTokenBody>;

/** `POST /tokens` answers with the token's plaintext, once. */
export const CreatedApiToken = ApiToken.extend({ token: PersonalToken });
export type CreatedApiToken = z.infer<typeof CreatedApiToken>;
