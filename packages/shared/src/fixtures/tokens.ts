import {
  ApiToken,
  CreatedApiToken,
  PERSONAL_TOKEN_PATTERN,
  TOKEN_DISPLAY_PREFIX_LENGTH,
} from "../schemas/token";
import { fixtureIds as ids } from "./ids";

// The owner's personal tokens. Only `createdApiToken` carries a plaintext token, as only the
// answer to `POST /tokens` does, and it is an obvious fake that matches the format.

/** Made up, never issued: `lift_pat_` and 32 characters. */
const FAKE_TOKEN = `lift_pat_${"fixtureTokenNotARealSecret".padEnd(32, "0")}`;
if (!PERSONAL_TOKEN_PATTERN.test(FAKE_TOKEN))
  throw new Error("the fixture token has the wrong format");

/** `GET /tokens` for the owner: a CLI token in use, and a CI token revoked since. */
export const apiTokens = [
  ApiToken.parse({
    id: ids.tokens.laptop,
    userId: ids.users.owner,
    name: "laptop",
    prefix: "lift_pat_7Qm",
    scopes: ["deploy"],
    projectId: null,
    lastUsedAt: "2026-11-18T16:05:00Z",
    revokedAt: null,
    createdAt: "2026-11-17T09:12:00Z",
  }),
  ApiToken.parse({
    id: ids.tokens.oldCi,
    userId: ids.users.owner,
    name: "old ci",
    prefix: "lift_pat_c1X",
    scopes: ["read"],
    projectId: null,
    lastUsedAt: "2026-11-17T08:00:00Z",
    revokedAt: "2026-11-18T10:30:00Z",
    createdAt: "2026-11-16T12:00:00Z",
  }),
];

/** `POST /tokens`: the one answer with a token's plaintext. */
export const createdApiToken = CreatedApiToken.parse({
  id: ids.tokens.created,
  userId: ids.users.owner,
  name: "new laptop",
  prefix: FAKE_TOKEN.slice(0, TOKEN_DISPLAY_PREFIX_LENGTH),
  scopes: ["deploy"],
  projectId: null,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: "2026-11-18T17:00:00Z",
  token: FAKE_TOKEN,
});
