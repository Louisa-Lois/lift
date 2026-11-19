import { type Db, schema } from "@lift/db";
import { newId, type User } from "@lift/shared";
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
