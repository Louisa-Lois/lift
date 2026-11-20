import {
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
import { type EditorDeps, editorTree, openSession } from "../../services/editor";
import type { Github } from "../../services/github";
import { accessService } from "../../services/services";

const ServiceParams = z.object({ serviceId: ServiceId });

/** BE-17: the live editor's file tree and sessions. The editing itself goes through collab. */
export const editorRoutes: FastifyPluginAsyncZod<{
  github: Github;
  secretBox: SecretBox | null;
  collab: CollabClient;
  collabSecret: string | undefined;
}> = async (app, { github, secretBox, collab, collabSecret }) => {
  const deps = (log: FastifyBaseLogger): EditorDeps => ({
    db: app.db,
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
};
