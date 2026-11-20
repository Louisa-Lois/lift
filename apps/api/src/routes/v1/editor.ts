import {
  cursorPage,
  EditorChange,
  EditorCommitBody,
  EditorCommitResponse,
  EditorDiscardBody,
  EditorDiscardResponse,
  EditorSession,
  EditorSessionBody,
  EditorTree,
  EditorTreeQuery,
  ServiceId,
} from "@lift/shared";
import type { FastifyBaseLogger } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser } from "../../plugins/auth";
import type { CollabClient } from "../../services/collab-client";
import type { SecretBox } from "../../services/crypto";
import {
  commitChanges,
  discardChanges,
  type EditorDeps,
  editorTree,
  listChanges,
  openSession,
} from "../../services/editor";
import type { Github } from "../../services/github";
import { accessService } from "../../services/services";

const ServiceParams = z.object({ serviceId: ServiceId });

/**
 * BE-17 and BE-18: the live editor's file tree and sessions, its changes, Commit & deploy, and
 * discard. The editing itself goes through the collab server.
 */
export const editorRoutes: FastifyPluginAsyncZod<{
  github: Github;
  secretBox: SecretBox | null;
  collab: CollabClient;
  collabSecret: string | undefined;
}> = async (app, { github, secretBox, collab, collabSecret }) => {
  const deps = (log: FastifyBaseLogger): EditorDeps => ({
    db: app.db,
    redis: app.redis,
    queues: app.queues,
    github,
    secretBox,
    collab,
    collabSecret,
    log,
  });

  app.get(
    "/services/:serviceId/editor/tree",
    {
      schema: {
        summary: "The files the live editor lists, at the service's branch",
        description:
          "Read with the project owner's GitHub token. `binary` marks files the editor won't open: by extension, and symlinks.",
        tags: ["editor"],
        params: ServiceParams,
        querystring: EditorTreeQuery,
        response: { 200: EditorTree },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { service, project } = await accessService(app.db, request.params.serviceId, user.id);
      return editorTree(deps(request.log), service, project, request.query.ref);
    },
  );

  app.post(
    "/services/:serviceId/editor/session",
    {
      // Viewers open files too, read-only. A personal token needs the admin scope, as for any
      // write: the collab token it gets can edit.
      config: { role: "viewer" },
      schema: {
        summary: "Open a file in the live editor",
        description:
          "The first open loads the file from the service's branch; a later one reloads it if it changed on GitHub and nobody has a draft. Connect a Hocuspocus provider with `documentName` and `token` (10 minutes; ask again for each connection). Text files up to 512 KB.",
        tags: ["editor"],
        params: ServiceParams,
        body: EditorSessionBody,
        response: { 200: EditorSession },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { service, project, role } = await accessService(
        app.db,
        request.params.serviceId,
        user.id,
      );
      return openSession(deps(request.log), {
        service,
        project,
        role,
        user,
        path: request.body.path,
      });
    },
  );

  app.get(
    "/services/:serviceId/editor/changes",
    {
      schema: {
        summary: "The files with drafts: what Commit & deploy would commit",
        tags: ["editor"],
        params: ServiceParams,
        response: { 200: cursorPage(EditorChange) },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { service } = await accessService(app.db, request.params.serviceId, user.id);
      return { data: await listChanges(deps(request.log), service), nextCursor: null };
    },
  );

  app.post(
    "/services/:serviceId/editor/commit",
    {
      // It deploys, so a personal token needs the deploy scope.
      config: { scope: "deploy" },
      schema: {
        summary: "Commit the drafts to the branch, as you, and deploy the commit",
        description:
          "Every draft, or `paths`. A 409 `conflict` names each file that changed on GitHub since its draft started, in `fields`; discard and reload those. The deployment has trigger `editor`, and the push webhook that follows is skipped.",
        tags: ["editor"],
        params: ServiceParams,
        body: EditorCommitBody,
        response: { 200: EditorCommitResponse },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { service, project } = await accessService(
        app.db,
        request.params.serviceId,
        user.id,
        "editor",
      );
      return commitChanges(deps(request.log), {
        service,
        project,
        user,
        message: request.body.message,
        paths: request.body.paths,
      });
    },
  );

  app.post(
    "/services/:serviceId/editor/discard",
    {
      config: { scope: "deploy" },
      schema: {
        summary: "Reload drafts from the branch, for everyone editing them",
        description: "Every draft, or `paths`.",
        tags: ["editor"],
        params: ServiceParams,
        body: EditorDiscardBody,
        response: { 200: EditorDiscardResponse },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { service, project } = await accessService(
        app.db,
        request.params.serviceId,
        user.id,
        "editor",
      );
      return discardChanges(deps(request.log), { service, project, paths: request.body.paths });
    },
  );
};
