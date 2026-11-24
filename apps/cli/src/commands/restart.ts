import { getAuthenticatedClient } from "../client";
import { type OutputContext, printJson, printText } from "../output";
import { resolveTargetProject, resolveTargetService } from "../resolve";

export interface RestartOptions {
  apiUrl?: string;
  configDir?: string;
  project?: string;
  service?: string;
  cwd?: string;
}

export async function restartCommand(options: RestartOptions, ctx?: OutputContext): Promise<void> {
  const { client } = getAuthenticatedClient(options);
  const projectId = await resolveTargetProject(client, options);
  const serviceId = await resolveTargetService(client, projectId, options);

  const service = await client.services.restart(serviceId);

  if (ctx?.json) {
    printJson(service, ctx);
  } else {
    printText(`Restarting service ${service.name}...`, ctx);
  }
}
