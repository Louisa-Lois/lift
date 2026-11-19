import { type AutofixJob, type BuildJob, type DeployJob, JOBS, OpsJob } from "@lift/shared";
import type { Queues } from "../plugins/queues";

/** Finished jobs stay a day (failed ones a week) for debugging, then BullMQ drops them. */
const RETENTION = {
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

// Every payload is checked against its strict schema before it is added, so a secret can never
// ride along (packages/shared/src/jobs.ts).

/** `lift-build`, with the deployment's ID as the job ID: asking twice queues it once. */
export async function enqueueBuild(queues: Queues, job: BuildJob): Promise<void> {
  const payload = JOBS.build.payload.parse(job);
  await queues.build.add(JOBS.build.name, payload, { ...RETENTION, jobId: payload.deploymentId });
}

/** `lift-deploy`, with the deployment's ID as the job ID: asking twice queues it once. */
export async function enqueueDeploy(queues: Queues, job: DeployJob): Promise<void> {
  const payload = JOBS.deploy.payload.parse(job);
  await queues.deploy.add(JOBS.deploy.name, payload, { ...RETENTION, jobId: payload.deploymentId });
}

/**
 * Drops a canceled deployment's build job if the worker hasn't taken it yet. If it has, its next
 * status report gets 409 and the worker stops on its own.
 */
export async function dropQueuedBuild(queues: Queues, deploymentId: string): Promise<void> {
  await queues.build.remove(deploymentId).catch(() => 0);
}

/**
 * The job ID that makes asking twice queue an op once, for ops that happen once. A restart can be
 * asked for again later, and a finished job keeps its ID for a day, so it gets none.
 */
function opJobId(payload: OpsJob): string | undefined {
  switch (payload.op) {
    case "remove_service":
      return `remove_service-${payload.serviceId}`;
    case "provision_db":
    case "deprovision_db":
      return `${payload.op}-${payload.databaseId}`;
    case "stop":
      return `stop-${payload.deploymentId}`;
    case "restart":
      return undefined;
  }
}

/**
 * `lift-agent` → `autofix` for a failed deployment (AI-06). The job ID makes it once per
 * deployment, however often the failure is reported.
 */
export async function enqueueAutofix(queues: Queues, job: AutofixJob): Promise<void> {
  const payload = JOBS.autofix.payload.parse(job);
  await queues.agent.add(JOBS.autofix.name, payload, {
    ...RETENTION,
    jobId: `autofix-${payload.deploymentId}`,
  });
}

/** Adds a `lift-ops` job; one that happens once gets a fixed job ID. */
export async function enqueueOp(queues: Queues, job: OpsJob): Promise<void> {
  const payload = OpsJob.parse(job);
  const jobId = opJobId(payload);
  await queues.ops.add(payload.op, payload, { ...RETENTION, ...(jobId ? { jobId } : {}) });
}
