import { getAuthenticatedClient } from "../client";
import { CliError, UsageError } from "../errors";
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
  tail?: string | number;
}

export async function logsCommand(options: LogsOptions, ctx?: OutputContext): Promise<void> {
  let tailCount: number | undefined;
  if (options.tail !== undefined) {
    const parsed = Number(options.tail);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new UsageError(
        `Invalid tail count '${options.tail}'. Must be a positive integer.`,
        "Pass a positive integer for --tail, e.g. `lift logs --tail 100`.",
      );
    }
    tailCount = parsed;
  }

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

  const snapshot = await client.deployments.logs(deploymentId, { tail: tailCount });

  if (ctx?.json) {
    printJson(snapshot.data, ctx);
  } else {
    for (const entry of snapshot.data) {
      printText(entry.line, ctx);
    }
  }
}
