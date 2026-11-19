import { type Db, schema } from "@lift/db";
import {
  type CursorPage,
  newId,
  type Project,
  type ProjectBase,
  type ProjectDetail,
  type ProjectListItem,
  type ProjectRole,
} from "@lift/shared";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { uniqueViolation } from "../lib/db-errors";
import type { ProjectRow } from "./access";
import { type EventRow, recordEvent } from "./events";
import { projectServices, type ServiceRow, serviceViews } from "./services";
import { slugify, withSuffix } from "./slugs";

export function toProjectBase(row: ProjectRow): ProjectBase {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    ownerId: row.ownerId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toProject(row: ProjectRow, role: ProjectRole): Project {
  return { ...toProjectBase(row), role };
}

/** `GET /projects/:id`: the project with its services. Databases arrive with BE-10. */
export async function projectDetail(
  db: Db,
  project: ProjectRow,
  role: ProjectRole,
  appsDomain: string,
): Promise<ProjectDetail> {
  const services = await serviceViews(db, await projectServices(db, project.id), appsDomain);
  return { ...toProject(project, role), services, databases: [] };
}

/**
 * The caller's projects, newest first, each with its services' latest deployment status. The
 * cursor is an offset: people have few projects, and an offset can't skip rows.
 */
export async function listProjects(
  db: Db,
  userId: string,
  page: { limit: number; offset: number },
): Promise<CursorPage<ProjectListItem>> {
  const p = schema.projects;
  const rows = await db
    .select({ project: p, role: schema.projectMembers.role })
    .from(schema.projectMembers)
    .innerJoin(p, eq(p.id, schema.projectMembers.projectId))
    .where(and(eq(schema.projectMembers.userId, userId), isNull(p.deletedAt)))
    .orderBy(desc(p.createdAt), desc(p.id))
    .limit(page.limit + 1)
    .offset(page.offset);
  const visible = rows.slice(0, page.limit);

  const projectIds = visible.map((row) => row.project.id);
  const services: Pick<ServiceRow, "id" | "name" | "projectId">[] =
    projectIds.length === 0
      ? []
      : await db
          .select({
            id: schema.services.id,
            name: schema.services.name,
            projectId: schema.services.projectId,
          })
          .from(schema.services)
          .where(
            and(inArray(schema.services.projectId, projectIds), isNull(schema.services.deletedAt)),
          )
          .orderBy(asc(schema.services.createdAt));
  const d = schema.deployments;
  const latest =
    services.length === 0
      ? []
      : await db
          .selectDistinctOn([d.serviceId], {
            serviceId: d.serviceId,
            status: d.status,
            createdAt: d.createdAt,
          })
          .from(d)
          .where(
            inArray(
              d.serviceId,
              services.map((service) => service.id),
            ),
          )
          .orderBy(d.serviceId, desc(d.queuedAt));
  const latestBy = new Map(latest.map((row) => [row.serviceId, row]));

  const data = visible.map(({ project, role }): ProjectListItem => {
    const own = services.filter((service) => service.projectId === project.id);
    const deployedAt = own
      .map((service) => latestBy.get(service.id)?.createdAt.getTime())
      .filter((time): time is number => time !== undefined);
    return {
      ...toProject(project, role),
      services: own.map((service) => ({
        id: service.id,
        name: service.name,
        status: latestBy.get(service.id)?.status ?? null,
      })),
      lastDeployedAt:
        deployedAt.length > 0 ? new Date(Math.max(...deployedAt)).toISOString() : null,
    };
  });
  return {
    data,
    nextCursor: rows.length > page.limit ? String(page.offset + page.limit) : null,
  };
}

const MAX_ATTEMPTS = 5;

/** Creates the project with the creator as its owner; a clashing slug gets a suffix. */
export async function createProjectRows(
  db: Db,
  ownerId: string,
  name: string,
): Promise<ProjectRow> {
  let slug = slugify(name);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.projects)
          .values({ id: newId("prj"), name, slug, ownerId })
          .returning();
        if (!row) throw new Error("insert returned no project");
        await tx
          .insert(schema.projectMembers)
          .values({ projectId: row.id, userId: ownerId, role: "owner" });
        return row;
      });
    } catch (error) {
      if (uniqueViolation(error) !== "projects_slug_unique" || attempt >= MAX_ATTEMPTS) throw error;
      slug = withSuffix(slug);
    }
  }
}

/** Renames the project (its slug never changes) and records `project.updated`. */
export async function renameProjectRows(
  db: Db,
  input: { project: ProjectRow; actorId: string; name: string },
): Promise<{ row: ProjectRow; event: EventRow }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.projects)
      .set({ name: input.name })
      .where(eq(schema.projects.id, input.project.id))
      .returning();
    if (!row) throw new Error("update returned no project");
    const event = await recordEvent(tx, {
      projectId: row.id,
      actorType: "user",
      actorId: input.actorId,
      type: "project.updated",
      data: toProjectBase(row),
    });
    return { row, event };
  });
}

/**
 * Soft-deletes the project and its services and records `project.deleted`. The caller queues
 * `remove_service` for each returned service.
 */
export async function deleteProjectRows(
  db: Db,
  input: { project: ProjectRow; actorId: string },
): Promise<{ services: ServiceRow[]; event: EventRow }> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx
      .update(schema.projects)
      .set({ deletedAt: now })
      .where(eq(schema.projects.id, input.project.id))
      .returning();
    if (!row) throw new Error("update returned no project");
    const services = await tx
      .update(schema.services)
      .set({ deletedAt: now })
      .where(and(eq(schema.services.projectId, row.id), isNull(schema.services.deletedAt)))
      .returning();
    const event = await recordEvent(tx, {
      projectId: row.id,
      actorType: "user",
      actorId: input.actorId,
      type: "project.deleted",
      data: toProjectBase(row),
    });
    return { services, event };
  });
}
