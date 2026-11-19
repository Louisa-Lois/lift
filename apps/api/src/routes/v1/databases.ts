import {
  CreateDatabaseBody,
  cursorPage,
  Database,
  DatabaseCredentials,
  DatabaseId,
  ProjectId,
} from "@lift/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { enqueueOp } from "../../jobs/enqueue";
import { problem } from "../../lib/problem";
import { requireUser } from "../../plugins/auth";
import { accessProject } from "../../services/access";
import { requireSecretBox, type SecretBox } from "../../services/crypto";
import {
  accessDatabase,
  createDatabaseRows,
  credentialsOf,
  deleteDatabaseRows,
  projectDatabases,
  toDatabase,
} from "../../services/databases";
import { publishEvents } from "../../services/events";

const ProjectParams = z.object({ projectId: ProjectId });
const DatabaseParams = z.object({ databaseId: DatabaseId });

/**
 * BE-10: a project's Postgres database (docs/prd/01-backend-api.md, "Databases"). The worker
 * creates it; once it's ready, every service of the project gets DATABASE_URL. Redis waits: it's
 * the first extra Lift drops when dates slip.
 */
export const databaseRoutes: FastifyPluginAsyncZod<{ secretBox: SecretBox | null }> = async (
  app,
  { secretBox },
) => {
  app.get(
    "/projects/:projectId/databases",
    {
      schema: {
        summary: "A project's databases",
        tags: ["databases"],
        params: ProjectParams,
        response: { 200: cursorPage(Database) },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { project } = await accessProject(app.db, request.params.projectId, user.id);
      const rows = await projectDatabases(app.db, project.id);
      return { data: rows.map(toDatabase), nextCursor: null };
    },
  );

  app.post(
    "/projects/:projectId/databases",
    {
      schema: {
        summary: "Add a Postgres database; answers 202 while it is provisioned",
        description:
          "Once it's ready, Lift writes DATABASE_URL into every service of the project, unless a user set that key. One per project.",
        tags: ["databases"],
        params: ProjectParams,
        body: CreateDatabaseBody,
        response: { 202: Database },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const { project } = await accessProject(app.db, request.params.projectId, user.id, "editor");
      if (request.body.type !== "postgres") {
        throw problem("validation_failed", "Lift offers Postgres for now; Redis comes later.", {
          fields: { type: "Only postgres is available" },
        });
      }
      const { row, event } = await createDatabaseRows(app.db, {
        project,
        type: request.body.type,
        name: request.body.name,
        actorId: user.id,
        secretBox: requireSecretBox(secretBox),
      });
      await publishEvents(app.redis, [event], request.log);
      await enqueueOp(app.queues, {
        op: "provision_db",
        databaseId: row.id,
        projectId: row.projectId,
        type: row.type,
      });
      reply.code(202);
      return toDatabase(row);
    },
  );

  app.get(
    "/databases/:databaseId",
    {
      schema: {
        summary: "A database",
        tags: ["databases"],
        params: DatabaseParams,
        response: { 200: Database },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { database } = await accessDatabase(app.db, request.params.databaseId, user.id);
      return toDatabase(database);
    },
  );

  app.get(
    "/databases/:databaseId/credentials",
    {
      config: { scope: "admin" },
      schema: {
        summary: "How to connect, with the password (editors)",
        description:
          "The host is lift-pg, reachable only from the project's services. 409 until the database is ready.",
        tags: ["databases"],
        params: DatabaseParams,
        response: { 200: DatabaseCredentials },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { database } = await accessDatabase(
        app.db,
        request.params.databaseId,
        user.id,
        "editor",
      );
      return credentialsOf(database, requireSecretBox(secretBox));
    },
  );

  app.delete(
    "/databases/:databaseId",
    {
      schema: {
        summary: "Delete a database and its data; answers 202 with it `deleting`",
        description: "Its DATABASE_URL leaves every service at once; the worker drops it.",
        tags: ["databases"],
        params: DatabaseParams,
        response: { 202: Database },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const { database } = await accessDatabase(
        app.db,
        request.params.databaseId,
        user.id,
        "editor",
      );
      const { row, events } = await deleteDatabaseRows(app.db, { database, actorId: user.id });
      await publishEvents(app.redis, events, request.log);
      await enqueueOp(app.queues, {
        op: "deprovision_db",
        databaseId: row.id,
        projectId: row.projectId,
        type: row.type,
      });
      reply.code(202);
      return toDatabase(row);
    },
  );
};
