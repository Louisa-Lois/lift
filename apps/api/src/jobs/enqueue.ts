import { OpsJob } from "@lift/shared";
import type { Queues } from "../plugins/queues";

/** Finished jobs stay a day (failed ones a week) for debugging, then BullMQ drops them. */
const RETENTION = {
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

/**
 * Adds a `lift-ops` job (packages/shared/src/jobs.ts). The payload is checked against its strict
 * schema first, so a secret can never ride along. `remove_service` gets a fixed job ID, so asking
 * twice queues it once.
 */
export async function enqueueOp(queues: Queues, job: OpsJob): Promise<void> {
  const payload = OpsJob.parse(job);
  const jobId = payload.op === "remove_service" ? `remove_service-${payload.serviceId}` : undefined;
  await queues.ops.add(payload.op, payload, { ...RETENTION, ...(jobId ? { jobId } : {}) });
}
