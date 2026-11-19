import { type Db, schema } from "@lift/db";
import { newId, type User } from "@lift/shared";
import { eq } from "drizzle-orm";
import { problem } from "../lib/problem";
import type { SecretBox } from "./crypto";
import type { UserRow } from "./sessions";

export interface GithubAccount {
  githubId: number;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string;
}

/**
 * Creates the Lift user for a GitHub account on first sign-in, or refreshes its profile and
 * token on the next one (matched by GitHub's numeric ID, which survives renames).
 */
export async function upsertGithubUser(
  db: Db,
  account: GithubAccount,
  githubTokenEnc: Buffer,
): Promise<UserRow> {
  const profile = {
    login: account.login,
    name: account.name,
    email: account.email,
    avatarUrl: account.avatarUrl,
    githubTokenEnc,
  };
  const [row] = await db
    .insert(schema.users)
    .values({ id: newId("usr"), githubId: account.githubId, ...profile })
    .onConflictDoUpdate({ target: schema.users.githubId, set: profile })
    .returning();
  if (!row) throw new Error("upsert returned no user");
  return row;
}

/** A user by ID, for the agent service acting as them; null when there's none. */
export async function findUserById(db: Db, id: string): Promise<UserRow | null> {
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  return row ?? null;
}

/** The `User` the API sends: never the token. */
export function toUser(row: UserRow): User {
  return {
    id: row.id,
    githubId: row.githubId,
    login: row.login,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatarUrl,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The user's GitHub token, decrypted for one call to GitHub; never logged or returned. */
export function githubTokenOf(secretBox: SecretBox | null, user: UserRow): string {
  if (!secretBox) {
    throw problem(
      "upstream_unavailable",
      "This server has no ENCRYPTION_KEY to read GitHub tokens.",
    );
  }
  return secretBox.decrypt(user.githubTokenEnc);
}
