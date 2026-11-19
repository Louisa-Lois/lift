import { createHash, randomBytes } from "node:crypto";
import { type Db, schema } from "@lift/db";
import { and, eq, gt } from "drizzle-orm";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Sessions last 14 days and slide: a request extends one once a day has passed. */
export const SESSION_TTL_MS = 14 * DAY_MS;
const SLIDE_AFTER_MS = DAY_MS;

export type UserRow = typeof schema.users.$inferSelect;

/** The cookie holds a random token; the database keeps only its SHA-256, the session's ID. */
export function sessionIdFor(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  db: Db,
  input: { userId: string; ip: string | null; userAgent: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(schema.sessions).values({
    id: sessionIdFor(token),
    userId: input.userId,
    expiresAt,
    ip: input.ip,
    userAgent: input.userAgent?.slice(0, 512) ?? null,
  });
  return { token, expiresAt };
}

/** The unexpired session for a cookie token, with its user, or null. */
export async function findSession(
  db: Db,
  token: string,
): Promise<{ id: string; expiresAt: Date; user: UserRow } | null> {
  const [row] = await db
    .select({ id: schema.sessions.id, expiresAt: schema.sessions.expiresAt, user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(
      and(eq(schema.sessions.id, sessionIdFor(token)), gt(schema.sessions.expiresAt, new Date())),
    )
    .limit(1);
  return row ?? null;
}

/** A new expiry when the session is due to slide (more than a day used), otherwise null. */
export async function slideSession(
  db: Db,
  session: { id: string; expiresAt: Date },
): Promise<Date | null> {
  const now = Date.now();
  if (session.expiresAt.getTime() - now > SESSION_TTL_MS - SLIDE_AFTER_MS) return null;
  const expiresAt = new Date(now + SESSION_TTL_MS);
  await db.update(schema.sessions).set({ expiresAt }).where(eq(schema.sessions.id, session.id));
  return expiresAt;
}

export async function deleteSession(db: Db, sessionId: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
}
