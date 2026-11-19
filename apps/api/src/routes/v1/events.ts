import { schema } from "@lift/db";
import {
  AnyProjectEvent,
  cursorPage,
  ProjectEventsQuery,
  ProjectId,
  REDIS_STREAMS,
} from "@lift/shared";
import { desc, eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { numberCursor } from "../../lib/pagination";
import { followStream, openSse, startingPoint } from "../../lib/sse";
import { requireUser } from "../../plugins/auth";
import { accessProject } from "../../services/access";
import { toEventJson } from "../../services/events";

const ProjectParams = z.object({ projectId: ProjectId });

/**
 * BE-06: a project's activity, as a list and live. The stream sends each event under its type
 * with its Redis Stream entry ID, resumes after `Last-Event-ID`, and sends a heartbeat comment
 * whenever nothing happened for `heartbeatMs`.
 */
export const eventRoutes: FastifyPluginAsyncZod<{ heartbeatMs: number }> = async (
  app,
  { heartbeatMs },
) => {
  app.get(
    "/projects/:projectId/events",
    {
      schema: {
        summary: "A project's activity, newest first",
        tags: ["events"],
        params: ProjectParams,
        querystring: ProjectEventsQuery,
        response: { 200: cursorPage(AnyProjectEvent) },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { project } = await accessProject(app.db, request.params.projectId, user.id);
      const { limit, cursor } = request.query;
      const offset = numberCursor(cursor, 0);
      const rows = await app.db
        .select()
        .from(schema.events)
        .where(eq(schema.events.projectId, project.id))
        .orderBy(desc(schema.events.createdAt), desc(schema.events.id))
        .limit(limit + 1)
        .offset(offset);
      return {
        data: rows.slice(0, limit).map(toEventJson),
        nextCursor: rows.length > limit ? String(offset + limit) : null,
      };
    },
  );

  app.get(
    "/projects/:projectId/events/stream",
    {
      schema: {
        summary: "A project's activity, live (Server-Sent Events)",
        description:
          "Each message's `event` is the event's type and its `data` the whole event. Send `Last-Event-ID` to resume.",
        tags: ["events"],
        params: ProjectParams,
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const { project } = await accessProject(app.db, request.params.projectId, user.id);
      const key = REDIS_STREAMS.projectEvents.key(project.id);
      const after = await startingPoint(app.redis, key, request.headers["last-event-id"]);
      const sse = openSse(request, reply);
      try {
        await followStream(app.redis, {
          key,
          after,
          sse,
          heartbeatMs,
          onEntry: async (id, fields) => {
            const event = parseEvent(fields.event);
            if (event) await sse.send({ id, event: event.type, data: fields.event ?? "" });
            return true;
          },
        });
      } catch (error) {
        request.log.warn({ err: error }, "project event stream stopped");
      } finally {
        sse.end();
      }
    },
  );
};

/** An entry's event, or null when it isn't one (the stream is ours, but stay defensive). */
function parseEvent(json: string | undefined): { type: string } | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as unknown;
    return typeof value === "object" && value !== null && "type" in value
      ? { type: String(value.type) }
      : null;
  } catch {
    return null;
  }
}
