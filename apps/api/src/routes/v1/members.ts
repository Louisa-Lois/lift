import {
  AddMemberBody,
  cursorPage,
  ProjectId,
  ProjectMember,
  UpdateMemberBody,
  UserId,
} from "@lift/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser } from "../../plugins/auth";
import { accessProject } from "../../services/access";
import { publishEvents } from "../../services/events";
import { addMember, listMembers, removeMember, updateMember } from "../../services/members";

const ProjectParams = z.object({ projectId: ProjectId });
const MemberParams = ProjectParams.extend({ userId: UserId });

/**
 * BE-15: a project's members. Everyone in it can see them; only the owner adds, changes and
 * removes them (by GitHub login, as editor or viewer).
 */
export const memberRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/projects/:projectId/members",
    {
      schema: {
        summary: "A project's members, the owner first",
        tags: ["members"],
        params: ProjectParams,
        response: { 200: cursorPage(ProjectMember) },
      },
    },
    async (request) => {
      const { project } = await accessProject(
        app.db,
        request.params.projectId,
        requireUser(request).id,
      );
      return { data: await listMembers(app.db, project.id), nextCursor: null };
    },
  );

  app.post(
    "/projects/:projectId/members",
    {
      config: { role: "owner" },
      schema: {
        summary: "Add someone by GitHub login (owner); they must have signed in to Lift once",
        tags: ["members"],
        params: ProjectParams,
        body: AddMemberBody,
        response: { 201: ProjectMember },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const { project } = await accessProject(app.db, request.params.projectId, user.id, "owner");
      const { member, event } = await addMember(app.db, {
        project,
        login: request.body.login,
        role: request.body.role,
        actorId: user.id,
      });
      await publishEvents(app.redis, [event], request.log);
      reply.code(201);
      return member;
    },
  );

  app.patch(
    "/projects/:projectId/members/:userId",
    {
      config: { role: "owner" },
      schema: {
        summary: "Change a member's role between editor and viewer (owner)",
        tags: ["members"],
        params: MemberParams,
        body: UpdateMemberBody,
        response: { 200: ProjectMember },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { project } = await accessProject(app.db, request.params.projectId, user.id, "owner");
      const { member, event } = await updateMember(app.db, {
        project,
        userId: request.params.userId,
        role: request.body.role,
        actorId: user.id,
      });
      if (event) await publishEvents(app.redis, [event], request.log);
      return member;
    },
  );

  app.delete(
    "/projects/:projectId/members/:userId",
    {
      config: { role: "owner" },
      schema: {
        summary: "Remove a member (owner); they lose access at once",
        tags: ["members"],
        params: MemberParams,
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const { project } = await accessProject(app.db, request.params.projectId, user.id, "owner");
      const event = await removeMember(app.db, {
        project,
        userId: request.params.userId,
        actorId: user.id,
      });
      await publishEvents(app.redis, [event], request.log);
      return reply.code(204).send();
    },
  );
};
