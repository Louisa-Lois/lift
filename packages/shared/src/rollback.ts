import type { Deployment } from "./schemas/deployment";

/**
 * How many of a service's images Lift keeps (docs/prd/04-infrastructure.md, "Cleanup": "keep the
 * images of each service's last 3 deployments"). INF-14's cleanup deletes the rest.
 */
export const ROLLBACK_IMAGES = 3;

/** What the rule needs to know about each of a service's deployments. */
export type DeploymentImage = Pick<Deployment, "id" | "status" | "imageTag" | "createdAt">;

/**
 * The image tags Lift keeps for one service: the 3 most recent distinct tags among its
 * deployments, plus the active deployment's. A failed build has no image, so it doesn't count,
 * and a rollback copies its target's tag, so that image counts once. INF-14 deletes exactly the
 * images this doesn't keep, so a rollback offered today never finds its image gone.
 */
export function keptImageTags(deployments: readonly DeploymentImage[]): Set<string> {
  const newestFirst = [...deployments].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : -1),
  );
  const kept = new Set<string>();
  for (const deployment of newestFirst) {
    if (kept.size >= ROLLBACK_IMAGES) break;
    if (deployment.imageTag) kept.add(deployment.imageTag);
  }
  const active = deployments.find((deployment) => deployment.status === "active");
  if (active?.imageTag) kept.add(active.imageTag);
  return kept;
}

export type RollbackCheck = { ok: true } | { ok: false; reason: string };

/**
 * Whether "Rollback to this" is offered for `target`, given the service's deployments: it must
 * have been live and then replaced (`superseded`), its image must be one Lift keeps, and that
 * image mustn't be what is running now.
 */
export function rollbackTarget(
  target: DeploymentImage,
  deployments: readonly DeploymentImage[],
): RollbackCheck {
  if (target.status === "active") return { ok: false, reason: "This deployment is live now." };
  if (target.status !== "superseded" || !target.imageTag) {
    return { ok: false, reason: "Only a deployment that was live can be rolled back to." };
  }
  const active = deployments.find((deployment) => deployment.status === "active");
  if (active?.imageTag === target.imageTag) {
    return { ok: false, reason: "Its image is the one running now." };
  }
  if (!keptImageTags(deployments).has(target.imageTag)) {
    return {
      ok: false,
      reason: `Lift keeps the images of a service's last ${ROLLBACK_IMAGES} builds; this one's is gone.`,
    };
  }
  return { ok: true };
}
