import { z } from "zod";
import {
  Builder,
  DatabaseStatus,
  DatabaseType,
  DeploymentErrorCode,
  DeploymentStatus,
  VariableSource,
} from "./enums";
import { DatabaseId, DeploymentId, ProjectId, ServiceId } from "./ids";
import {
  CommitSha,
  Cpu,
  FilePath,
  HealthcheckPath,
  Hostname,
  MemoryMb,
  Port,
  RepoWithBranch,
  RootDir,
  Slug,
  Timestamp,
  VariableKey,
} from "./schemas/common";
import { CreateDiagnosisBody, Diagnosis } from "./schemas/diagnosis";
import { CreateEvalRunBody, EvalRun } from "./schemas/eval";
import { MetricSample } from "./schemas/metrics";

// Bodies of the internal API (docs/contracts.md, "Worker jobs"; docs/prd/01-backend-api.md, "API
// surface"). These routes listen only on the control plane's private IP, under INTERNAL_BASE_PATH.
// Worker routes need `Authorization: Bearer {WORKER_TOKEN}`; agent routes need AGENT_SERVICE_TOKEN.

/**
 * `GET /deployments/:id/build-context`. With an OAuth app the clone token is the project owner's
 * GitHub token, not a short-lived one (`expiresAt: null`): use it for the one clone, never write
 * it to disk or a log.
 */
export const BuildContext = z.object({
  deploymentId: DeploymentId,
  serviceId: ServiceId,
  projectId: ProjectId,
  repo: RepoWithBranch,
  commitSha: CommitSha,
  rootDir: RootDir,
  builder: Builder,
  dockerfilePath: FilePath.nullable(),
  buildCommand: z.string().nullable(),
  startCommand: z.string().nullable(),
  clone: z.object({ token: z.string().min(1), expiresAt: Timestamp.nullable() }),
  /** Decrypted variables to pass at build time: build args or Railpack `--env`. */
  buildVariables: z.record(VariableKey, z.string()),
});
export type BuildContext = z.infer<typeof BuildContext>;

export const RuntimeEnvVariable = z.object({
  key: VariableKey,
  value: z.string(),
  source: VariableSource,
});
export type RuntimeEnvVariable = z.infer<typeof RuntimeEnvVariable>;

/**
 * `GET /deployments/:id/runtime-env`: the stored variables decrypted, plus the `system` ones (PORT,
 * LIFT_SERVICE_ID, LIFT_DEPLOYMENT_ID, LIFT_PUBLIC_URL). `envHash` is opaque; desired-state
 * carries the same hash, so the worker can tell when a container's environment is stale.
 */
export const RuntimeEnv = z.object({
  deploymentId: DeploymentId,
  variables: z.array(RuntimeEnvVariable),
  envHash: z.string().min(1),
});
export type RuntimeEnv = z.infer<typeof RuntimeEnv>;

/** The statuses the worker reports; the API sets the others. */
export const WORKER_DEPLOYMENT_STATUSES = [
  "building",
  "deploying",
  "active",
  "failed",
] as const satisfies readonly DeploymentStatus[];

const report = { message: z.string().max(2_000).optional(), at: Timestamp };

/**
 * `POST /deployments/:id/status`. Each status brings what the state machine needs: `deploying`
 * the image, `active` the container, `failed` the error code. Reporting the same status twice is
 * fine; a report the state machine refuses (say, for a canceled deployment) gets 409 `conflict`,
 * and the worker stops working on that deployment.
 */
export const DeploymentStatusReport = z.discriminatedUnion("status", [
  z.object({ status: z.literal("building"), ...report }),
  z.object({ status: z.literal("deploying"), imageTag: z.string().min(1), ...report }),
  z.object({ status: z.literal("active"), containerId: z.string().min(1), ...report }),
  z.object({ status: z.literal("failed"), errorCode: DeploymentErrorCode, ...report }),
]);
export type DeploymentStatusReport = z.infer<typeof DeploymentStatusReport>;

/** The deployment's status after the report. */
export const DeploymentStatusReportResponse = z.object({ status: DeploymentStatus });
export type DeploymentStatusReportResponse = z.infer<typeof DeploymentStatusReportResponse>;

/**
 * `GET /databases/:id/provision-context`: credentials for a new database. For Postgres, `dbName`
 * and `username` are the database ID; Redis has neither.
 */
export const ProvisionContext = z.object({
  databaseId: DatabaseId,
  projectId: ProjectId,
  type: DatabaseType,
  dbName: z.string().nullable(),
  username: z.string().nullable(),
  password: z.string().min(1),
});
export type ProvisionContext = z.infer<typeof ProvisionContext>;

/**
 * `POST /databases/:id/status`: `ready` with where to reach it, or `failed`. After
 * `deprovision_db` the worker reports only a failure; the API already marked the database deleted.
 */
export const DatabaseStatusReport = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    host: z.string().min(1),
    port: Port,
    message: z.string().max(2_000).optional(),
  }),
  z.object({ status: z.literal("failed"), message: z.string().max(2_000).optional() }),
]);
export type DatabaseStatusReport = z.infer<typeof DatabaseStatusReport>;

export const DatabaseStatusReportResponse = z.object({ status: DatabaseStatus });
export type DatabaseStatusReportResponse = z.infer<typeof DatabaseStatusReportResponse>;

/** `POST /metrics`, every 15 seconds: one sample per running Lift container. */
export const MetricsReport = z.object({ samples: z.array(MetricSample).min(1).max(1_000) });
export type MetricsReport = z.infer<typeof MetricsReport>;

export const MetricsReportResponse = z.object({ accepted: z.number().int().min(0) });
export type MetricsReportResponse = z.infer<typeof MetricsReportResponse>;

/** One deployment that should be running. */
export const DesiredDeployment = z.object({
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
  envHash: z.string().min(1),
});
export type DesiredDeployment = z.infer<typeof DesiredDeployment>;

/** One ready database whose container (Redis) or database (Postgres) should exist. */
export const DesiredDatabase = z.object({
  databaseId: DatabaseId,
  projectId: ProjectId,
  type: DatabaseType,
});
export type DesiredDatabase = z.infer<typeof DesiredDatabase>;

/**
 * `GET /worker/desired-state`, polled at start and every 60 seconds. Lift containers not listed
 * here (apps or `lift-redis-*`) are removed after 5 minutes' grace.
 */
export const DesiredState = z.object({
  deployments: z.array(DesiredDeployment),
  databases: z.array(DesiredDatabase),
});
export type DesiredState = z.infer<typeof DesiredState>;

type InternalRoute = {
  method: "GET" | "POST";
  path: (id: string) => string;
  auth: "worker" | "agent";
  body?: z.ZodType;
  response: z.ZodType;
};

/** Every internal route. Paths are relative to INTERNAL_BASE_PATH (`/internal/v1`). */
export const INTERNAL_ROUTES = {
  buildContext: {
    method: "GET",
    path: (deploymentId: string) => `/deployments/${deploymentId}/build-context`,
    auth: "worker",
    response: BuildContext,
  },
  runtimeEnv: {
    method: "GET",
    path: (deploymentId: string) => `/deployments/${deploymentId}/runtime-env`,
    auth: "worker",
    response: RuntimeEnv,
  },
  deploymentStatus: {
    method: "POST",
    path: (deploymentId: string) => `/deployments/${deploymentId}/status`,
    auth: "worker",
    body: DeploymentStatusReport,
    response: DeploymentStatusReportResponse,
  },
  provisionContext: {
    method: "GET",
    path: (databaseId: string) => `/databases/${databaseId}/provision-context`,
    auth: "worker",
    response: ProvisionContext,
  },
  databaseStatus: {
    method: "POST",
    path: (databaseId: string) => `/databases/${databaseId}/status`,
    auth: "worker",
    body: DatabaseStatusReport,
    response: DatabaseStatusReportResponse,
  },
  metrics: {
    method: "POST",
    path: () => "/metrics",
    auth: "worker",
    body: MetricsReport,
    response: MetricsReportResponse,
  },
  desiredState: {
    method: "GET",
    path: () => "/worker/desired-state",
    auth: "worker",
    response: DesiredState,
  },
  diagnoses: {
    method: "POST",
    path: () => "/agent/diagnoses",
    auth: "agent",
    body: CreateDiagnosisBody,
    response: Diagnosis,
  },
  evalRuns: {
    method: "POST",
    path: () => "/evals/runs",
    auth: "agent",
    body: CreateEvalRunBody,
    response: EvalRun,
  },
} as const satisfies Record<string, InternalRoute>;
