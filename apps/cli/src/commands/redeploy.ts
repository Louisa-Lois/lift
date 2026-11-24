import { getAuthenticatedClient } from "../client";
import { type OutputContext, printJson, printText } from "../output";
import { resolveTargetProject, resolveTargetService } from "../resolve";

export interface RedeployOptions {
  apiUrl?: string;
  configDir?: string;
  project?: string;
  service?: string;
  cwd?: string;
}

export async function redeployCommand(
  options: RedeployOptions,
  ctx?: OutputContext,
): Promise<void> {
  const { client } = getAuthenticatedClient(options);
  const projectId = await resolveTargetProject(client, options);
  const serviceId = await resolveTargetService(client, projectId, options);

  const deployment = await client.deployments.create(serviceId);

  if (ctx?.json) {
    printJson(deployment, ctx);
  } else {
    printText(
      `Redeploy initiated. Queued deployment ${deployment.id}. Run \`lift logs --deployment ${deployment.id}\` to follow.`,
      ctx,
    );
  }
}
