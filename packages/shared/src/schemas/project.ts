import { z } from "zod";
import { DeploymentStatus, ProjectRole } from "../enums";
import { ProjectId, ServiceId, UserId } from "../ids";
import { ResourceName, Slug, Timestamp } from "./common";
import { Database } from "./database";
import { Service } from "./service";

/** A project as stored: what the `project.*` events carry. */
export const ProjectBase = z.object({
  id: ProjectId,
  name: ResourceName,
  /** Never changes after creation, even when the project is renamed. */
  slug: Slug,
  ownerId: UserId,
  createdAt: Timestamp,
});
export type ProjectBase = z.infer<typeof ProjectBase>;

/** A project as the API returns it, with the caller's role, so viewers get no write buttons. */
export const Project = ProjectBase.extend({ role: ProjectRole });
export type Project = z.infer<typeof Project>;

/** `GET /projects`: each card's services with their latest deployment status. */
export const ProjectListItem = Project.extend({
  services: z.array(
    z.object({ id: ServiceId, name: ResourceName, status: DeploymentStatus.nullable() }),
  ),
  lastDeployedAt: Timestamp.nullable(),
});
export type ProjectListItem = z.infer<typeof ProjectListItem>;

/** `GET /projects/:id`, and what `POST` and `PATCH` return. */
export const ProjectDetail = Project.extend({
  services: z.array(Service),
  databases: z.array(Database),
});
export type ProjectDetail = z.infer<typeof ProjectDetail>;

/** `POST /projects`. The slug is made from the name. */
export const CreateProjectBody = z.strictObject({ name: ResourceName });
export type CreateProjectBody = z.infer<typeof CreateProjectBody>;

/** `PATCH /projects/:id`: rename. */
export const UpdateProjectBody = z.strictObject({ name: ResourceName });
export type UpdateProjectBody = z.infer<typeof UpdateProjectBody>;
