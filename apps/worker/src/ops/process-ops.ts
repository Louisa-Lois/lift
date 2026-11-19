import type { OpsJob } from "@lift/shared";
import type { Docker } from "../docker";
import type { Logger } from "../logger";

/**
 * `lift-ops` jobs. `remove_service` removes every container of a deleted service; `stop`,
 * `restart` and the database ops arrive with INF-10, and fail loudly until then, so BullMQ keeps
 * them (a week) instead of dropping them.
 */
export async function processOp(
  job: OpsJob,
  deps: { docker: Docker; log: Logger },
): Promise<string> {
  switch (job.op) {
    case "remove_service": {
      const containers = await deps.docker.listContainers([`lift.service=${job.serviceId}`]);
      for (const container of containers) await deps.docker.removeContainer(container.Id);
      deps.log.info(
        { serviceId: job.serviceId, removed: containers.length },
        "removed a deleted service's containers",
      );
      return `removed ${containers.length} container(s)`;
    }
    default:
      throw new Error(`The worker can't run "${job.op}" yet (INF-10)`);
  }
}
