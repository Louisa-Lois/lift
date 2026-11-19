import { createHash } from "node:crypto";
import { type Db, schema } from "@lift/db";
import {
  appHostname,
  appUrl,
  type BuildContext,
  type DeploymentStatus,
  type RuntimeEnv,
  type RuntimeEnvVariable,
} from "@lift/shared";
import { eq } from "drizzle-orm";
import { problem } from "../lib/problem";
import type { SecretBox } from "./crypto";
import { githubTokenOf } from "./users";
import { decryptedVariables } from "./variables";

async function deploymentWithService(db: Db, deploymentId: string) {
  const [row] = await db
    .select({
      deployment: schema.deployments,
      service: schema.services,
      ownerId: schema.projects.ownerId,
    })
    .from(schema.deployments)
    .innerJoin(schema.services, eq(schema.services.id, schema.deployments.serviceId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.deployments.projectId))
    .where(eq(schema.deployments.id, deploymentId))
    .limit(1);
  if (!row) throw problem("not_found", `No deployment ${deploymentId}.`);
  return row;
}

/** The worker may fetch what it needs only while the deployment is at that stage. */
function requireStatus(
  deploymentId: string,
  status: DeploymentStatus,
  allowed: readonly DeploymentStatus[],
  deleted: boolean,
): void {
  if (deleted) throw problem("conflict", `Deployment ${deploymentId}'s service was deleted.`);
  if (!allowed.includes(status)) {
    throw problem("conflict", `Deployment ${deploymentId} is ${status}.`);
  }
}

/**
 * `GET /internal/v1/deployments/:id/build-context`: what the worker needs to clone and build.
 * The clone token is the project owner's GitHub token (an OAuth app has no short-lived ones), so
 * it is handed out only while the deployment is queued or building.
 */
export async function buildContext(
  db: Db,
  secretBox: SecretBox | null,
  deploymentId: string,
): Promise<BuildContext> {
  const { deployment, service, ownerId } = await deploymentWithService(db, deploymentId);
  requireStatus(
    deploymentId,
    deployment.status,
    ["queued", "building"],
    service.deletedAt !== null,
  );
  const [owner] = await db.select().from(schema.users).where(eq(schema.users.id, ownerId));
  if (!owner) throw new Error(`project of ${deploymentId} has no owner`);
  return {
    deploymentId: deployment.id,
    serviceId: service.id,
    projectId: service.projectId,
    repo: { owner: service.repoOwner, name: service.repoName, branch: service.branch },
    commitSha: deployment.commitSha,
    rootDir: service.rootDir,
    builder: service.builder,
    dockerfilePath: service.dockerfilePath,
    buildCommand: service.buildCommand,
    startCommand: service.startCommand,
    clone: { token: githubTokenOf(secretBox, owner), expiresAt: null },
    // Every stored variable is there at build time too: Next.js inlines NEXT_PUBLIC_* while it builds.
    buildVariables: Object.fromEntries(
      (await decryptedVariables(db, secretBox, service.id)).map(({ key, value }) => [key, value]),
    ),
  };
}

/** `envHash`: SHA-256 over the sorted `KEY=value` lines, so the same environment gives the same hash. */
export function envHashOf(variables: RuntimeEnvVariable[]): string {
  const lines = variables.map((variable) => `${variable.key}=${variable.value}`).sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

/**
 * `GET /internal/v1/deployments/:id/runtime-env`: the container's environment, while the
 * deployment is deploying or active (reconciliation recreates active containers): the service's
 * stored variables, decrypted, as they are now (so a rollback runs with today's), plus the system
 * ones, which are never stored: PORT, LIFT_SERVICE_ID, LIFT_DEPLOYMENT_ID and LIFT_PUBLIC_URL.
 */
export async function runtimeEnv(
  db: Db,
  secretBox: SecretBox | null,
  appsDomain: string,
  deploymentId: string,
): Promise<RuntimeEnv> {
  const { deployment, service } = await deploymentWithService(db, deploymentId);
  requireStatus(
    deploymentId,
    deployment.status,
    ["deploying", "active"],
    service.deletedAt !== null,
  );
  const system = (key: string, value: string): RuntimeEnvVariable => ({
    key,
    value,
    source: "system",
  });
  const variables = [
    ...(await decryptedVariables(db, secretBox, service.id)),
    system("PORT", String(service.port)),
    system("LIFT_SERVICE_ID", service.id),
    system("LIFT_DEPLOYMENT_ID", deployment.id),
    system("LIFT_PUBLIC_URL", appUrl(appHostname(service.subdomain, appsDomain), appsDomain)),
  ].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { deploymentId: deployment.id, variables, envHash: envHashOf(variables) };
}
