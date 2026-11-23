import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { type Db, schema } from "@lift/db";
import {
  type CliLoginStatus,
  newId,
  type PollCliLoginResponse,
  type StartCliLoginResponse,
} from "@lift/shared";
import { and, eq, gt, lt } from "drizzle-orm";
import { createToken, tokenHash } from "./tokens";

const t = schema.cliLogins;

/** How long a code lasts: long enough to sign in with GitHub first. */
export const CLI_LOGIN_TTL_MS = 10 * 60_000;
/** An approved login can still be collected this long after it expires, for a late approval. */
export const CLI_LOGIN_COLLECT_GRACE_MS = 30_000;
/** Logins that expired longer ago than this are deleted when the next one starts. */
const KEEP_EXPIRED_MS = 24 * 60 * 60_000;
/** Consonants only: no vowels, so a code never spells a word, and no 0/O or 1/I to confuse. */
const CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";

/** Eight letters shown as `BCDF-GHJK`: 20^8 codes, so a collision is rare and simply retried. */
export function generateCliLoginCode(): string {
  let letters = "";
  for (let i = 0; i < 8; i++) letters += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

/**
 * Counts starts in memory, `limit` a `windowMs` across all callers: the API runs as one process,
 * and behind Traefik every request has the same `request.ip`, so there's no caller to count by.
 * BE-21 brings real rate limits.
 */
export function cliLoginStartLimiter({ limit = 30, windowMs = 60_000 } = {}) {
  let windowStart = Number.NEGATIVE_INFINITY;
  let count = 0;
  return (now = Date.now()): boolean => {
    if (now - windowStart >= windowMs) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    return count <= limit;
  };
}

/**
 * Starts a CLI login. The database keeps only the SHA-256 of the poll secret, like a token's,
 * and logins that expired over a day ago are deleted on the way.
 */
export async function startCliLogin(
  db: Db,
  publicUrl: string,
  now = new Date(),
): Promise<StartCliLoginResponse> {
  await db.delete(t).where(lt(t.expiresAt, new Date(now.getTime() - KEEP_EXPIRED_MS)));
  const pollSecret = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + CLI_LOGIN_TTL_MS);
  const site = publicUrl.replace(/\/+$/, "");
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCliLoginCode();
    const [row] = await db
      .insert(t)
      .values({ id: newId("cli"), code, pollSecretHash: tokenHash(pollSecret), expiresAt })
      .onConflictDoNothing({ target: t.code })
      .returning({ code: t.code });
    if (row) {
      return {
        code,
        verifyUrl: `${site}/cli-auth?code=${code}`,
        pollSecret,
        expiresAt: expiresAt.toISOString(),
      };
    }
  }
  throw new Error("no free CLI login code after 5 tries");
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The CLI's poll. Null, which the route answers with 404, for an unknown code or a missing or
 * wrong poll secret alike, so a poll learns nothing about logins that aren't its own. An approved
 * login hands out its token once: the first poll after approval creates it.
 */
export async function pollCliLogin(
  db: Db,
  input: { code: string; pollSecret: string | null; isAllowed: (login: string) => boolean },
  now = new Date(),
): Promise<PollCliLoginResponse | null> {
  if (!input.pollSecret) return null;
  const [row] = await db.select().from(t).where(eq(t.code, input.code)).limit(1);
  if (!row || !sameHash(row.pollSecretHash, tokenHash(input.pollSecret))) return null;

  if (row.status === "denied") return { status: "denied" };
  if (row.status === "expired") return { status: "expired" };
  if (row.status === "pending") {
    return row.expiresAt > now ? { status: "pending" } : { status: "expired" };
  }

  // Approved: collected once, by the first poll, within the grace after expiry.
  const collectBy = row.expiresAt.getTime() + CLI_LOGIN_COLLECT_GRACE_MS;
  if (!row.userId || now.getTime() >= collectBy) return { status: "expired" };
  const userId = row.userId;
  return db.transaction(async (tx): Promise<PollCliLoginResponse> => {
    // Under the row's lock, so of two polls at once only one finds it not yet collected.
    const [locked] = await tx
      .select({ status: t.status, tokenId: t.tokenId })
      .from(t)
      .where(eq(t.id, row.id))
      .for("update");
    if (locked?.status !== "approved" || locked.tokenId) return { status: "expired" };
    const [approver] = await tx
      .select({ login: schema.users.login })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!approver || !input.isAllowed(approver.login)) {
      // The approver's login was taken off ALLOWED_GITHUB_LOGINS since: no token for them now.
      await tx.update(t).set({ status: "denied" }).where(eq(t.id, row.id));
      return { status: "denied" };
    }
    const created = await createToken(tx, {
      userId,
      name: `lift login · ${now.toISOString().slice(0, 10)}`,
      scopes: ["admin"],
    });
    await tx.update(t).set({ tokenId: created.id }).where(eq(t.id, row.id));
    return { status: "approved", token: created.token };
  });
}

export type CliLoginDecision =
  | { kind: "decided"; code: string; status: CliLoginStatus }
  | { kind: "not_found" }
  | { kind: "already"; status: CliLoginStatus };

/**
 * The signed-in user approves or denies a pending, unexpired code, in one conditional update, so
 * two decisions at once can't both win. Otherwise: no such code, or what became of it.
 */
export async function decideCliLogin(
  db: Db,
  input: { code: string; userId: string; status: "approved" | "denied" },
  now = new Date(),
): Promise<CliLoginDecision> {
  const [decided] = await db
    .update(t)
    .set({ status: input.status, userId: input.userId })
    .where(and(eq(t.code, input.code), eq(t.status, "pending"), gt(t.expiresAt, now)))
    .returning({ code: t.code, status: t.status });
  if (decided) return { kind: "decided", ...decided };
  const [row] = await db
    .select({ status: t.status, expiresAt: t.expiresAt })
    .from(t)
    .where(eq(t.code, input.code))
    .limit(1);
  if (!row) return { kind: "not_found" };
  return { kind: "already", status: row.status === "pending" ? "expired" : row.status };
}
