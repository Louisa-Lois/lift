import { z } from "zod";
import { DeploymentErrorCode, DeploymentStatus, DeploymentTrigger } from "../enums";
import {
  AgentActionId,
  DeploymentEventId,
  DeploymentId,
  ProjectId,
  ServiceId,
  UserId,
} from "../ids";
import { CommitSha, Timestamp } from "./common";

/**
 * One deployment of one commit. Immutable apart from its status and what the worker reports
 * (image, container, error). The state machine is in docs/prd/01-backend-api.md.
 */
export const Deployment = z.object({
  id: DeploymentId,
  serviceId: ServiceId,
  projectId: ProjectId,
  status: DeploymentStatus,
  trigger: DeploymentTrigger,
  commitSha: CommitSha,
  commitMessage: z.string().nullable(),
  /** The commit author's GitHub login when GitHub knows it, otherwise their git name. */
  commitAuthor: z.string().nullable(),
  /** `lift/{serviceId}:{deploymentId}`, once built; a rollback copies its target's. */
  imageTag: z.string().nullable(),
  containerId: z.string().nullable(),
  rollbackOf: DeploymentId.nullable(),
  errorCode: DeploymentErrorCode.nullable(),
  errorMessage: z.string().nullable(),
  createdByUserId: UserId.nullable(),
  createdByActionId: AgentActionId.nullable(),
  queuedAt: Timestamp,
  startedAt: Timestamp.nullable(),
  finishedAt: Timestamp.nullable(),
  createdAt: Timestamp,
});
export type Deployment = z.infer<typeof Deployment>;

/** The latest deployment of a service, embedded in the service. */
export const DeploymentSummary = Deployment.pick({
  id: true,
  status: true,
  commitSha: true,
  createdAt: true,
});
export type DeploymentSummary = z.infer<typeof DeploymentSummary>;

/** One step of a deployment's timeline (a `deployment_events` row). */
export const DeploymentTimelineEntry = z.object({
  id: DeploymentEventId,
  status: DeploymentStatus,
  message: z.string().nullable(),
  at: Timestamp,
});
export type DeploymentTimelineEntry = z.infer<typeof DeploymentTimelineEntry>;

/** `GET /deployments/:id`: the deployment with its timeline, oldest step first. */
export const DeploymentDetail = Deployment.extend({ timeline: z.array(DeploymentTimelineEntry) });
export type DeploymentDetail = z.infer<typeof DeploymentDetail>;

/** `POST /services/:id/deployments` → 202 with the queued deployment. Defaults to the branch head. */
export const CreateDeploymentBody = z.strictObject({ commitSha: CommitSha.optional() });
export type CreateDeploymentBody = z.infer<typeof CreateDeploymentBody>;
