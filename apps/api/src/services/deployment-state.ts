import type { DeploymentStatus } from "@lift/shared";

/**
 * The deployment state machine (docs/prd/01-backend-api.md, "Deployments"): every status a
 * deployment may move to from each status. A new deployment starts `queued`, or `deploying`
 * for a rollback, which reuses an image.
 */
export const TRANSITIONS: Readonly<Record<DeploymentStatus, readonly DeploymentStatus[]>> = {
  queued: ["building", "failed", "canceled"],
  building: ["deploying", "failed", "canceled"],
  deploying: ["active", "failed"],
  active: ["superseded"],
  failed: [],
  canceled: [],
  superseded: [],
};

export function canTransition(from: DeploymentStatus, to: DeploymentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

const FINISHED = new Set<DeploymentStatus>(["active", "failed", "canceled", "superseded"]);

/** Statuses after which no build or deploy runs, so the deployment's logs are complete. */
export function isFinished(status: DeploymentStatus): boolean {
  return FINISHED.has(status);
}
