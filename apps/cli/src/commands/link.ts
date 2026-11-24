import { getAuthenticatedClient } from "../client";
import { saveProjectLink } from "../config";
import { type OutputContext, printJson, printText } from "../output";
import { resolveTargetProject, resolveTargetService } from "../resolve";

export interface LinkOptions {
  apiUrl?: string;
  configDir?: string;
  project?: string;
  service?: string;
  cwd?: string;
}

export async function linkCommand(options: LinkOptions, ctx?: OutputContext): Promise<void> {
  const { client } = getAuthenticatedClient(options);

  const projectId = await resolveTargetProject(client, options);
  const project = await client.projects.get(projectId);

  const serviceId = await resolveTargetService(client, projectId, options);
  const service = await client.services.get(serviceId);

  saveProjectLink({ projectId, serviceId }, options.cwd);

  if (ctx?.json) {
    printJson(
      {
        projectId,
        serviceId,
        projectName: project.name,
        serviceName: service.name,
      },
      ctx,
    );
  } else {
    printText(`Linked to project ${project.name} and service ${service.name}.`, ctx);
  }
}
