import { z } from "zod";
import { AssignableRole, ProjectRole } from "../enums";
import { ProjectId, UserId } from "../ids";
import { GithubLogin, Timestamp } from "./common";
import { UserSummary } from "./user";

/** `GET /projects/:id/members`. */
export const ProjectMember = z.object({
  projectId: ProjectId,
  userId: UserId,
  role: ProjectRole,
  user: UserSummary,
  createdAt: Timestamp,
});
export type ProjectMember = z.infer<typeof ProjectMember>;

/**
 * `POST /projects/:id/members` (owner): invite by GitHub login. The person must have signed in to
 * Lift once; otherwise 404 `not_found`.
 */
export const AddMemberBody = z.strictObject({ login: GithubLogin, role: AssignableRole });
export type AddMemberBody = z.infer<typeof AddMemberBody>;

/** `PATCH /projects/:id/members/:userId` (owner). */
export const UpdateMemberBody = z.strictObject({ role: AssignableRole });
export type UpdateMemberBody = z.infer<typeof UpdateMemberBody>;
