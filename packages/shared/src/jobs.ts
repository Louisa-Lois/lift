import { z } from "zod";
import { Builder, DatabaseType } from "./enums";
import { DatabaseId, DeploymentId, ProjectId, ServiceId } from "./ids";
import {
  BranchName,
  CommitSha,
  Cpu,
  FilePath,
  GithubLogin,
  GithubRepoName,
  HealthcheckPath,
  Hostname,
  MemoryMb,
  Port,
  RootDir,
  Slug,
} from "./schemas/common";

/**
 * BullMQ queues on the control plane's Redis (docs/contracts.md, "Worker jobs"). The first three
 * go to the worker; `lift-agent` carries autofix jobs to the agent service.
 */
export const QUEUE_NAMES = {
  build: "lift-build",
  deploy: "lift-deploy",
  ops: "lift-ops",
  agent: "lift-agent",
} as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Job names. On `lift-ops` the job name is the payload's `op`. */
export const JOB_NAMES = { build: "build", deploy: "deploy", autofix: "autofix" } as const;

// Payloads are strict: an unknown field fails, so a secret can never ride along. The worker
// fetches secrets over the internal API when it needs them. Adding a field is a coordinated
// change, since the API and the worker must both have it.

/** `lift-build` → `build`. Idempotent by `deploymentId`. */
export const BuildJob = z.strictObject({
  deploymentId: DeploymentId,
  serviceId: ServiceId,
  projectId: ProjectId,
  repo: z.strictObject({ owner: GithubLogin, name: GithubRepoName, branch: BranchName }),
  commitSha: CommitSha,
  rootDir: RootDir,
  builder: Builder,
  dockerfilePath: FilePath.optional(),
});
export type BuildJob = z.infer<typeof BuildJob>;

/**
 * `lift-deploy` → `deploy`. Idempotent by `deploymentId`. `serviceSlug` names the container
 * (`lift-{serviceSlug}-{last 6 of deploymentId}`) and is its alias on the project network.
 */
export const DeployJob = z.strictObject({
  deploymentId: DeploymentId,
  serviceId: ServiceId,
  serviceSlug: Slug,
  projectId: ProjectId,
  imageTag: z.string().min(1),
  port: Port,
  healthcheckPath: HealthcheckPath,
  cpu: Cpu,
  memoryMb: MemoryMb,
  hostnames: z.array(Hostname).min(1),
});
export type DeployJob = z.infer<typeof DeployJob>;

export const OPS = ["stop", "restart", "remove_service", "provision_db", "deprovision_db"] as const;
export const Op = z.enum(OPS);
export type Op = z.infer<typeof Op>;

const deploymentOp = { deploymentId: DeploymentId, serviceId: ServiceId, projectId: ProjectId };
const databaseOp = { databaseId: DatabaseId, projectId: ProjectId, type: DatabaseType };

/**
 * `lift-ops`, a union on `op`, each with only the IDs it acts on.
 * - `stop`: cancel a deployment: abort its build if one is running, otherwise stop its container.
 * - `restart`: restart the deployment's container.
 * - `remove_service`: remove every container of a deleted service.
 * - `provision_db` · `deprovision_db`: credentials come from `provision-context`; a Postgres
 *   database and its role are named after the database ID (see `postgresNamesFor`).
 */
export const OpsJob = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("stop"), ...deploymentOp }),
  z.strictObject({ op: z.literal("restart"), ...deploymentOp }),
  z.strictObject({ op: z.literal("remove_service"), serviceId: ServiceId, projectId: ProjectId }),
  z.strictObject({ op: z.literal("provision_db"), ...databaseOp }),
  z.strictObject({ op: z.literal("deprovision_db"), ...databaseOp }),
]);
export type OpsJob = z.infer<typeof OpsJob>;

/** `lift-agent` → `autofix`: the API enqueues it when a deployment fails and autofix is on. */
export const AutofixJob = z.strictObject({ deploymentId: DeploymentId });
export type AutofixJob = z.infer<typeof AutofixJob>;

/** Every job: its queue, its name, and its payload schema. */
export const JOBS = {
  build: { queue: QUEUE_NAMES.build, name: JOB_NAMES.build, payload: BuildJob },
  deploy: { queue: QUEUE_NAMES.deploy, name: JOB_NAMES.deploy, payload: DeployJob },
  ops: { queue: QUEUE_NAMES.ops, payload: OpsJob },
  autofix: { queue: QUEUE_NAMES.agent, name: JOB_NAMES.autofix, payload: AutofixJob },
} as const;

/** The image a build produces (docs/prd/04-infrastructure.md, "Build job"). */
export function imageTagFor(serviceId: string, deploymentId: string): string {
  return `lift/${serviceId}:${deploymentId}`;
}

/**
 * A Postgres database and its login role are both named after the database ID, a valid
 * identifier (`db_` plus 24 lowercase letters and digits), so `deprovision_db` needs only the ID.
 */
export function postgresNamesFor(databaseId: string): { database: string; role: string } {
  return { database: databaseId, role: databaseId };
}
