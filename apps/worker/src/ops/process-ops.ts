import { type OpsJob, postgresNamesFor } from "@lift/shared";
import type { Sql } from "postgres";
import { projectNetwork } from "../deploy/labels";
import type { Docker } from "../docker";
import { type InternalApi, StopDeployment } from "../internal-api";
import type { Logger } from "../logger";
import { deprovisionPostgres, provisionPostgres } from "./postgres";

/** The shared Postgres for users' databases, as apps on a project network reach it. */
export const LIFT_PG = { container: "lift-pg", port: 5432 } as const;

export interface OpsDeps {
  docker: Docker;
  log: Logger;
  api?: InternalApi;
  /** lift-pg's superuser connection (LIFT_PG_URL); null on a worker without one. */
  pg?: Sql | null;
  // Seams for tests; by default these run the SQL in ops/postgres.ts.
  provision?: typeof provisionPostgres;
  deprovision?: typeof deprovisionPostgres;
}

/** What went wrong, short enough for a status report. Postgres's messages hold no secrets. */
function reason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 300 ? `${message.slice(0, 300)}…` : message;
}

function databaseDeps(deps: OpsDeps): { api: InternalApi; pg: Sql | null } {
  if (!deps.api) throw new Error("database ops need the internal API");
  return { api: deps.api, pg: deps.pg ?? null };
}

/**
 * `lift-ops` jobs. `remove_service` removes every container of a deleted service.
 * `provision_db` and `deprovision_db` create and drop a project's Postgres database on lift-pg
 * (INF-10). `stop` and `restart` arrive with BE-11 and fail loudly until then, so BullMQ keeps
 * them (a week) instead of dropping them.
 */
export async function processOp(job: OpsJob, deps: OpsDeps): Promise<string> {
  const { log } = deps;
  switch (job.op) {
    case "remove_service": {
      const containers = await deps.docker.listContainers([`lift.service=${job.serviceId}`]);
      for (const container of containers) await deps.docker.removeContainer(container.Id);
      log.info(
        { serviceId: job.serviceId, removed: containers.length },
        "removed a deleted service's containers",
      );
      return `removed ${containers.length} container(s)`;
    }

    case "provision_db": {
      const { api, pg } = databaseDeps(deps);
      const fail = (message: string) =>
        api.reportDatabase(job.databaseId, { status: "failed", message });
      if (job.type !== "postgres") {
        await fail("Lift offers Postgres for now; Redis comes later.");
        return "refused";
      }
      if (!pg) {
        await fail("This worker has no LIFT_PG_URL, so it can't create databases.");
        throw new Error("LIFT_PG_URL isn't set");
      }
      try {
        const context = await api.provisionContext(job.databaseId);
        await (deps.provision ?? provisionPostgres)(pg, context);
        // Apps reach lift-pg on their project's network, by its container name.
        const network = projectNetwork(job.projectId);
        if (!(await deps.docker.networkExists(network))) {
          await deps.docker.createNetwork(network, { "lift.project": job.projectId });
        }
        await deps.docker.connectNetwork(network, LIFT_PG.container);
        await api.reportDatabase(job.databaseId, {
          status: "ready",
          host: LIFT_PG.container,
          port: LIFT_PG.port,
        });
        log.info({ databaseId: job.databaseId }, "created a Postgres database");
        return "ready";
      } catch (error) {
        if (error instanceof StopDeployment) {
          log.info({ databaseId: job.databaseId, reason: error.message }, "the API stopped this");
          return "stopped";
        }
        await fail(`Lift couldn't create the database: ${reason(error)}`).catch(() => undefined);
        throw error;
      }
    }

    case "deprovision_db": {
      const { api, pg } = databaseDeps(deps);
      if (job.type !== "postgres") return "nothing to remove";
      if (!pg) throw new Error("LIFT_PG_URL isn't set");
      try {
        await (deps.deprovision ?? deprovisionPostgres)(
          pg,
          postgresNamesFor(job.databaseId).database,
        );
        // A project has one database, so lift-pg has no reason to stay on its network.
        await deps.docker.disconnectNetwork(projectNetwork(job.projectId), LIFT_PG.container);
        log.info({ databaseId: job.databaseId }, "dropped a Postgres database");
        return "dropped";
      } catch (error) {
        await api
          .reportDatabase(job.databaseId, {
            status: "failed",
            message: `Lift couldn't drop the database: ${reason(error)}`,
          })
          .catch(() => undefined);
        throw error;
      }
    }

    default:
      throw new Error(`The worker can't run "${job.op}" yet (INF-10)`);
  }
}
