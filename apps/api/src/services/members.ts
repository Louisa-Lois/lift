import { type Db, schema } from "@lift/db";
import type { AssignableRole, ProjectMember, ProjectRole } from "@lift/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import { problem } from "../lib/problem";
import type { ProjectRow } from "./access";
import { type EventRow, recordEvent } from "./events";
import type { UserRow } from "./sessions";

const m = schema.projectMembers;

type MemberRow = typeof schema.projectMembers.$inferSelect;

function toMember(row: MemberRow, user: UserRow): ProjectMember {
  return {
    projectId: row.projectId,
    userId: row.userId,
    role: row.role,
    user: { id: user.id, login: user.login, name: user.name, avatarUrl: user.avatarUrl },
    createdAt: row.createdAt.toISOString(),
  };
}

const ROLE_ORDER = sql`case ${m.role} when 'owner' then 0 when 'editor' then 1 else 2 end`;

/** A project's members: the owner first, then editors and viewers, oldest first. */
export async function listMembers(db: Db, projectId: string): Promise<ProjectMember[]> {
  const rows = await db
    .select({ member: m, user: schema.users })
    .from(m)
    .innerJoin(schema.users, eq(schema.users.id, m.userId))
    .where(eq(m.projectId, projectId))
    .orderBy(ROLE_ORDER, asc(m.createdAt));
  return rows.map((row) => toMember(row.member, row.user));
}

async function memberOf(db: Db, projectId: string, userId: string) {
  const [row] = await db
    .select({ member: m, user: schema.users })
    .from(m)
    .innerJoin(schema.users, eq(schema.users.id, m.userId))
    .where(and(eq(m.projectId, projectId), eq(m.userId, userId)))
    .limit(1);
  if (!row) throw problem("not_found", `${userId} isn't a member of this project.`);
  return row;
}

function changed(
  db: Db,
  input: {
    project: ProjectRow;
    actorId: string;
    member: ProjectMember;
    previousRole: ProjectRole | null;
    removed: boolean;
  },
): Promise<EventRow> {
  return recordEvent(db, {
    projectId: input.project.id,
    actorType: "user",
    actorId: input.actorId,
    type: "member.changed",
    data: { ...input.member, previousRole: input.previousRole, removed: input.removed },
  });
}

/**
 * BE-15: adds someone by GitHub login (case doesn't matter). They must have signed in to Lift
 * once, which also means they were on the invite list then.
 */
export async function addMember(
  db: Db,
  input: { project: ProjectRow; login: string; role: AssignableRole; actorId: string },
): Promise<{ member: ProjectMember; event: EventRow }> {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.login}) = ${input.login.toLowerCase()}`)
    .limit(1);
  if (!user) {
    throw problem(
      "not_found",
      `${input.login} hasn't signed in to Lift yet. Ask them to sign in once, then add them.`,
      { fields: { login: "Hasn't signed in to Lift yet" } },
    );
  }
  const [row] = await db
    .insert(m)
    .values({ projectId: input.project.id, userId: user.id, role: input.role })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    throw problem("conflict", `${user.login} is already a member of this project.`, {
      fields: { login: "Already a member" },
    });
  }
  const member = toMember(row, user);
  const event = await changed(db, { ...input, member, previousRole: null, removed: false });
  return { member, event };
}

/** Changes a member's role between editor and viewer. The owner's role doesn't change. */
export async function updateMember(
  db: Db,
  input: { project: ProjectRow; userId: string; role: AssignableRole; actorId: string },
): Promise<{ member: ProjectMember; event: EventRow | null }> {
  const current = await memberOf(db, input.project.id, input.userId);
  if (current.member.role === "owner") {
    throw problem("conflict", "The project's owner keeps the owner role.");
  }
  if (current.member.role === input.role) {
    return { member: toMember(current.member, current.user), event: null };
  }
  const [row] = await db
    .update(m)
    .set({ role: input.role })
    .where(and(eq(m.projectId, input.project.id), eq(m.userId, input.userId)))
    .returning();
  if (!row) throw problem("not_found", `${input.userId} isn't a member of this project.`);
  const member = toMember(row, current.user);
  const event = await changed(db, {
    ...input,
    member,
    previousRole: current.member.role,
    removed: false,
  });
  return { member, event };
}

/** Removes a member; they lose access at their next request. The owner can't be removed. */
export async function removeMember(
  db: Db,
  input: { project: ProjectRow; userId: string; actorId: string },
): Promise<EventRow> {
  const current = await memberOf(db, input.project.id, input.userId);
  if (current.member.role === "owner") {
    throw problem("conflict", "The project's owner can't be removed. Delete the project instead.");
  }
  await db.delete(m).where(and(eq(m.projectId, input.project.id), eq(m.userId, input.userId)));
  return changed(db, {
    ...input,
    member: toMember(current.member, current.user),
    previousRole: current.member.role,
    removed: true,
  });
}
