import { createHash, randomBytes } from "node:crypto";
import { type Db, schema } from "@lift/db";
import {
  type ApiToken,
  type CreatedApiToken,
  newId,
  PERSONAL_TOKEN_PATTERN,
  TOKEN_DISPLAY_PREFIX_LENGTH,
  TOKEN_PREFIXES,
  type TokenScope,
} from "@lift/shared";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import type { DbOrTx } from "./events";
import type { UserRow } from "./sessions";

export type ApiTokenRow = typeof schema.apiTokens.$inferSelect;

const t = schema.apiTokens;

/**
 * Scopes are levels, each including the ones before it: `read` sees, `deploy` also deploys, rolls
 * back, cancels and restarts, `admin` does everything the user's role allows.
 */
const SCOPE_RANK: Record<TokenScope, number> = { read: 0, deploy: 1, admin: 2 };

/** `last_used_at` is written at most this often, so a busy CLI doesn't write on every request. */
const TOUCH_EVERY_MS = 60_000;

/**
 * The database keeps only the SHA-256 of a token, like a session's cookie. A token is 192 random
 * bits, so a slow password hash would add nothing.
 */
export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** `lift_pat_` and 32 base64url characters: 24 random bytes. */
export function generateToken(): string {
  return `${TOKEN_PREFIXES.personal}${randomBytes(24).toString("base64url")}`;
}

/** The highest of a token's scopes, which is what it may do. */
export function scopeOf(scopes: readonly TokenScope[]): TokenScope {
  return scopes.reduce<TokenScope>(
    (best, scope) => (SCOPE_RANK[scope] > SCOPE_RANK[best] ? scope : best),
    "read",
  );
}

export function scopeCovers(held: TokenScope, needed: TokenScope): boolean {
  return SCOPE_RANK[held] >= SCOPE_RANK[needed];
}

export function toApiToken(row: ApiTokenRow): ApiToken {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
    projectId: row.projectId,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Creates a personal token. The answer is the only place its plaintext ever appears. It can run in
 * a transaction: a CLI login creates its token while it holds the login's row.
 */
export async function createToken(
  db: DbOrTx,
  input: { userId: string; name: string; scopes: readonly TokenScope[] },
): Promise<CreatedApiToken> {
  const token = generateToken();
  const [row] = await db
    .insert(t)
    .values({
      id: newId("tok"),
      userId: input.userId,
      name: input.name,
      prefix: token.slice(0, TOKEN_DISPLAY_PREFIX_LENGTH),
      tokenHash: tokenHash(token),
      scopes: [...new Set(input.scopes)],
      projectId: null,
    })
    .returning();
  if (!row) throw new Error("insert returned no token");
  return { ...toApiToken(row), token };
}

/** A user's tokens, newest first, revoked ones included. */
export async function listTokens(
  db: Db,
  userId: string,
  page: { limit: number; offset: number },
): Promise<ApiTokenRow[]> {
  return db
    .select()
    .from(t)
    .where(eq(t.userId, userId))
    .orderBy(desc(t.createdAt), desc(t.id))
    .limit(page.limit)
    .offset(page.offset);
}

/**
 * Revokes one of the user's tokens; revoking it again changes nothing. False when the user has no
 * such token (someone else's is reported the same way, as missing).
 */
export async function revokeToken(db: Db, userId: string, tokenId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: t.id, revokedAt: t.revokedAt })
    .from(t)
    .where(and(eq(t.id, tokenId), eq(t.userId, userId)))
    .limit(1);
  if (!row) return false;
  if (!row.revokedAt) {
    await db
      .update(t)
      .set({ revokedAt: new Date() })
      .where(and(eq(t.id, tokenId), isNull(t.revokedAt)));
  }
  return true;
}

/** The live token behind a bearer value, with its user; null for anything else. */
export async function findToken(
  db: Db,
  token: string,
): Promise<{ token: ApiTokenRow; user: UserRow } | null> {
  if (!PERSONAL_TOKEN_PATTERN.test(token)) return null;
  const [row] = await db
    .select({ token: t, user: schema.users })
    .from(t)
    .innerJoin(schema.users, eq(schema.users.id, t.userId))
    .where(and(eq(t.tokenHash, tokenHash(token)), isNull(t.revokedAt)))
    .limit(1);
  return row ?? null;
}

/** Records that a token was used, unless that was already recorded in the last minute. */
export async function touchToken(db: Db, token: ApiTokenRow, now = new Date()): Promise<void> {
  if (token.lastUsedAt && now.getTime() - token.lastUsedAt.getTime() < TOUCH_EVERY_MS) return;
  const cutoff = new Date(now.getTime() - TOUCH_EVERY_MS);
  await db
    .update(t)
    .set({ lastUsedAt: now })
    .where(and(eq(t.id, token.id), or(isNull(t.lastUsedAt), lt(t.lastUsedAt, cutoff))));
}
