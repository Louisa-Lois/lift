import { type Db, schema } from "@lift/db";
import type { ProjectRole } from "@lift/shared";
import { and, eq, isNull } from "drizzle-orm";
import { problem } from "../lib/problem";

export type ProjectRow = typeof schema.projects.$inferSelect;

const RANK: Record<ProjectRole, number> = { viewer: 0, editor: 1, owner: 2 };

/**
 * The caller's role in a live project. Non-members get the same 404 as a project that doesn't
 * exist, so IDs reveal nothing; a member whose role is too low gets 403.
 */
export async function accessProject(
  db: Db,
  projectId: string,
  userId: string,
  needed: ProjectRole = "viewer",
): Promise<{ project: ProjectRow; role: ProjectRole }> {
  const [row] = await db
    .select({ project: schema.projects, role: schema.projectMembers.role })
    .from(schema.projectMembers)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectMembers.projectId))
    .where(
      and(
        eq(schema.projectMembers.projectId, projectId),
        eq(schema.projectMembers.userId, userId),
        isNull(schema.projects.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw problem("not_found", `No project ${projectId}.`);
  if (RANK[row.role] < RANK[needed]) {
    throw problem("forbidden", `This needs the ${needed} role; you are a ${row.role}.`);
  }
  return row;
}
