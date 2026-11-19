import { schema } from "@lift/db";
import { DeploymentId, DeploymentLogsQuery, LogSnapshot, REDIS_STREAMS } from "@lift/shared";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { followStream, openSse, type SseConnection } from "../../lib/sse";
import { requireUser } from "../../plugins/auth";
import { isFinished } from "../../services/deployment-state";
import { accessDeployment } from "../../services/deployments";
import { compareIds, logSnapshot, readEntry, storedLog } from "../../services/logs";

const DeploymentParams = z.object({ deploymentId: DeploymentId });
const STREAM_ID = /^\d{1,20}-\d{1,20}$/;

const endOf = (sse: SseConnection, status: string, id?: string) =>
  sse.send({ ...(id ? { id } : {}), event: "end", data: JSON.stringify({ status }) });

/**
 * BE-07: a deployment's build and deploy logs. The snapshot gives the last lines; the stream
 * replays from the start (or after `Last-Event-ID`), follows live, and ends with one `end`
 * event carrying the final status.
 */
export const logRoutes: FastifyPluginAsyncZod<{ heartbeatMs: number }> = async (
  app,
  { heartbeatMs },
) => {
  app.get(
    "/deployments/:deploymentId/logs",
    {
      schema: {
        summary: "A deployment's last log lines, oldest first",
        tags: ["logs"],
        params: DeploymentParams,
        querystring: DeploymentLogsQuery,
        response: { 200: LogSnapshot },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { deployment } = await accessDeployment(app.db, request.params.deploymentId, user.id);
      return { data: await logSnapshot(app, deployment.id, request.query.tail) };
    },
  );

  app.get(
    "/deployments/:deploymentId/logs/stream",
    {
      schema: {
        summary: "A deployment's logs, live (Server-Sent Events)",
        description:
          "`log` events from the first line (or after `Last-Event-ID`), then one `end` event with the final status.",
        tags: ["logs"],
        params: DeploymentParams,
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const { deployment } = await accessDeployment(app.db, request.params.deploymentId, user.id);
      const key = REDIS_STREAMS.deploymentLogs.key(deployment.id);
      const lastEventId = request.headers["last-event-id"];
      const after =
        typeof lastEventId === "string" && STREAM_ID.test(lastEventId) ? lastEventId : "0-0";
      const live = (await app.redis.exists(key)) === 1;
      const sse = openSse(request, reply);
      try {
        if (!live && isFinished(deployment.status)) {
          // The stream has expired: replay the stored copy, then end.
          for (const entry of await storedLog(app.db, deployment.id)) {
            if (compareIds(entry.id, after) <= 0) continue;
            const { id, ...line } = entry;
            await sse.send({ id, event: "log", data: JSON.stringify(line) });
          }
          await endOf(sse, deployment.status);
          return;
        }
        await followStream(app.redis, {
          key,
          after,
          sse,
          heartbeatMs,
          onEntry: async (id, fields) => {
            const read = readEntry(id, fields);
            if (read?.kind === "end") {
              await endOf(sse, read.status, id);
              return false;
            }
            if (read) {
              const { id: _id, ...line } = read.entry;
              await sse.send({ id, event: "log", data: JSON.stringify(line) });
            }
            return true;
          },
          // A deployment that ended without its marker (Redis was down then) still ends here.
          onIdle: async () => {
            const [row] = await app.db
              .select({ status: schema.deployments.status })
              .from(schema.deployments)
              .where(eq(schema.deployments.id, deployment.id));
            if (!row || !isFinished(row.status)) return true;
            await endOf(sse, row.status);
            return false;
          },
        });
      } catch (error) {
        request.log.warn({ err: error }, "deployment log stream stopped");
      } finally {
        sse.end();
      }
    },
  );
};
