import { getAuthenticatedClient } from "../client";
import { CliError } from "../errors";
import { type OutputContext, printJson, printText } from "../output";
import { resolveTargetProject, resolveTargetService } from "../resolve";

export interface RollbackOptions {
  apiUrl?: string;
  configDir?: string;
  project?: string;
  service?: string;
  cwd?: string;
}

export async function rollbackCommand(
  targetDeploymentId: string | undefined,
  options: RollbackOptions,
  ctx?: OutputContext,
): Promise<void> {
  const { client } = getAuthenticatedClient(options);

  let deploymentId = targetDeploymentId;

  if (!deploymentId) {
    const projectId = await resolveTargetProject(client, options);
    const serviceId = await resolveTargetService(client, projectId, options);

    const deploymentsPage = await client.deployments.list(serviceId, { limit: 10 });
    const target = deploymentsPage.data.find(
      (d) => d.status === "superseded" || d.status === "active",
    );

    if (!target) {
      throw new CliError(
        "No previous deployment found to roll back to.",
        1,
        "Specify a deployment ID: `lift rollback <deploymentId>` or view deployments with `lift status`.",
      );
    }
    deploymentId = target.id;
  }

  const newDeployment = await client.deployments.rollback(deploymentId);

  if (ctx?.json) {
    printJson(newDeployment, ctx);
  } else {
    printText(
      `Rolling back to deployment ${deploymentId}. Queued new deployment ${newDeployment.id}.`,
      ctx,
    );
  }
}
