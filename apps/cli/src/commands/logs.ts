import { getAuthenticatedClient } from "../client";
import { CliError } from "../errors";
import { type OutputContext, printJson, printText } from "../output";
import { resolveTargetProject, resolveTargetService } from "../resolve";

export interface LogsOptions {
  apiUrl?: string;
  configDir?: string;
  project?: string;
  service?: string;
  cwd?: string;
  deployment?: string;
  follow?: boolean;
  tail?: number;
}

export async function logsCommand(options: LogsOptions, ctx?: OutputContext): Promise<void> {
  const { client } = getAuthenticatedClient(options);

  let deploymentId = options.deployment;

  if (!deploymentId) {
    const projectId = await resolveTargetProject(client, options);
    const serviceId = await resolveTargetService(client, projectId, options);

    const deploymentsPage = await client.deployments.list(serviceId, { limit: 1 });
    const latest = deploymentsPage.data[0];
    if (!latest) {
      throw new CliError(
        "No deployments found for this service.",
        1,
        "Run `lift up` to deploy the service first.",
      );
    }
    deploymentId = latest.id;
  }

  if (options.follow) {
    try {
      for await (const event of client.deployments.streamLogs(deploymentId)) {
        if (event.event === "log") {
          printText(event.data.line, ctx);
        } else if (event.event === "end") {
          break;
        }
      }
      return;
    } catch {
      // Fallback to static snapshot if stream is unavailable
    }
  }

  const snapshot = await client.deployments.logs(deploymentId, { tail: options.tail });

  if (ctx?.json) {
    printJson(snapshot.data, ctx);
  } else {
    for (const entry of snapshot.data) {
      printText(entry.line, ctx);
    }
  }
}
