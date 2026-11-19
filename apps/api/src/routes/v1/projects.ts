import {
  CreateProjectBody,
  CreateServiceBody,
  cursorPage,
  ListQuery,
  ProjectDetail,
  ProjectId,
  ProjectListItem,
  Service,
  UpdateProjectBody,
} from "@lift/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { enqueueOp } from "../../jobs/enqueue";
import { numberCursor } from "../../lib/pagination";
import { problem } from "../../lib/problem";
import { requireUser, triggerFor } from "../../plugins/auth";
import { accessProject } from "../../services/access";
import type { SecretBox } from "../../services/crypto";
import { resolveCommit, startDeployment } from "../../services/deployments";
import { publishEvents } from "../../services/events";
import type { Github } from "../../services/github";
import {
  createProjectRows,
  deleteProjectRows,
  listProjects,
  projectDetail,
  renameProjectRows,
} from "../../services/projects";
import { createServiceRows, projectServices, serviceViews } from "../../services/services";
import { githubTokenOf } from "../../services/users";
import { ensureWebhook } from "../../services/webhooks";

const ProjectParams = z.object({ projectId: ProjectId });

export interface ProjectRoutesOptions {
  appsDomain: string;
  github: Github;
  secretBox: SecretBox | null;
  /** Where GitHub sends push webhooks (no hooks while it's localhost). */
  publicUrl: string;
}

/** BE-05: projects, and creating services in them (docs/prd/01-backend-api.md). */
export const projectRoutes: FastifyPluginAsyncZod<ProjectRoutesOptions> = async (
  app,
  { appsDomain, github, secretBox, publicUrl },
) => {
  app.get(
    "/projects",
    {
      schema: {
        summary: "Your projects, newest first",
        tags: ["projects"],
        querystring: ListQuery,
        response: { 200: cursorPage(ProjectListItem) },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { limit, cursor } = request.query;
      return listProjects(app.db, user.id, { limit, offset: numberCursor(cursor, 0) });
    },
  );

  app.post(
    "/projects",
    {
      schema: {
        summary: "Create a project; you become its owner",
        tags: ["projects"],
        body: CreateProjectBody,
        response: { 201: ProjectDetail },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const project = await createProjectRows(app.db, user.id, request.body.name);
      reply.code(201);
      return projectDetail(app.db, project, "owner", appsDomain);
    },
  );

  app.get(
    "/projects/:projectId",
    {
      schema: {
        summary: "A project with its services",
        tags: ["projects"],
        params: ProjectParams,
        response: { 200: ProjectDetail },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { project, role } = await accessProject(app.db, request.params.projectId, user.id);
      return projectDetail(app.db, project, role, appsDomain);
    },
  );

  app.patch(
    "/projects/:projectId",
    {
      schema: {
        summary: "Rename a project (its slug stays)",
        tags: ["projects"],
        params: ProjectParams,
        body: UpdateProjectBody,
        response: { 200: ProjectDetail },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { project, role } = await accessProject(
        app.db,
        request.params.projectId,
        user.id,
        "editor",
      );
      const { row, event } = await renameProjectRows(app.db, {
        project,
        actorId: user.id,
        name: request.body.name,
      });
      await publishEvents(app.redis, [event], request.log);
      return projectDetail(app.db, row, role, appsDomain);
    },
  );

  app.delete(
    "/projects/:projectId",
    {
      schema: {
        summary: "Delete a project and its services (owners only)",
        tags: ["projects"],
        params: ProjectParams,
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const { project } = await accessProject(app.db, request.params.projectId, user.id, "owner");
      const { services, event } = await deleteProjectRows(app.db, { project, actorId: user.id });
      await publishEvents(app.redis, [event], request.log);
      for (const service of services) {
        await enqueueOp(app.queues, {
          op: "remove_service",
          serviceId: service.id,
          projectId: project.id,
        });
      }
      return reply.code(204).send();
    },
  );

  app.get(
    "/projects/:projectId/services",
    {
      schema: {
        summary: "A project's services",
        tags: ["services"],
        params: ProjectParams,
        response: { 200: cursorPage(Service) },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { project } = await accessProject(app.db, request.params.projectId, user.id);
      const rows = await projectServices(app.db, project.id);
      return { data: await serviceViews(app.db, rows, appsDomain), nextCursor: null };
    },
  );

  app.post(
    "/projects/:projectId/services",
    {
      schema: {
        summary: "Create a service from a GitHub repo, with its generated domain",
        tags: ["services"],
        params: ProjectParams,
        body: CreateServiceBody,
        response: { 201: Service },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const { project } = await accessProject(app.db, request.params.projectId, user.id, "editor");
      const { repo, branch } = request.body;
      const token = githubTokenOf(secretBox, user);
      if (!(await github.getRepo(token, repo.owner, repo.name))) {
        throw problem(
          "github_error",
          `You can't read ${repo.owner}/${repo.name} on GitHub, or it doesn't exist.`,
          { fields: { "repo.name": "Not found, or you have no access to it" } },
        );
      }
      if (!(await github.branchExists(token, repo.owner, repo.name, branch))) {
        throw problem("validation_failed", `${repo.owner}/${repo.name} has no branch ${branch}.`, {
          fields: { branch: "No such branch" },
        });
      }
      const { row, event } = await createServiceRows(app.db, {
        project,
        actorId: user.id,
        body: request.body,
        appsDomain,
      });
      await publishEvents(app.redis, [event], request.log);
      await ensureWebhook(
        { db: app.db, github, secretBox, publicUrl, log: request.log },
        row,
        token,
      );
      if (request.body.deploy) {
        try {
          const commit = await resolveCommit(github, token, row);
          await startDeployment(
            { db: app.db, redis: app.redis, queues: app.queues, log: request.log },
            {
              service: row,
              trigger: triggerFor(request),
              commit,
              actor: { type: "user", id: user.id },
            },
          );
        } catch (error) {
          // The service exists either way; an error answer now would only invite a duplicate.
          request.log.warn(
            { err: error, serviceId: row.id },
            "created the service but couldn't start its first deployment",
          );
        }
      }
      const [view] = await serviceViews(app.db, [row], appsDomain);
      reply.code(201);
      return view as Service;
    },
  );
};
