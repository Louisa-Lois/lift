import { getAuthenticatedClient } from "../client";
import { UsageError } from "../errors";
import { type OutputContext, printJson, printText, renderTable } from "../output";
import { resolveTargetProject, resolveTargetService } from "../resolve";

export interface EnvOptions {
  apiUrl?: string;
  configDir?: string;
  project?: string;
  service?: string;
  cwd?: string;
  reveal?: boolean;
}

export async function envListCommand(options: EnvOptions, ctx?: OutputContext): Promise<void> {
  const { client } = getAuthenticatedClient(options);
  const projectId = await resolveTargetProject(client, options);
  const serviceId = await resolveTargetService(client, projectId, options);

  const varsPage = await client.variables.list(serviceId, {
    reveal: Boolean(options.reveal),
  });

  if (ctx?.json) {
    printJson(varsPage.data, ctx);
    return;
  }

  if (varsPage.data.length === 0) {
    printText("No environment variables found.", ctx);
    return;
  }

  const headers = ["KEY", "VALUE", "SOURCE"];
  const rows = varsPage.data.map((v) => [v.key, v.value, v.source]);
  printText(renderTable(headers, rows), ctx);
}

export async function envSetCommand(
  pairs: string[],
  options: EnvOptions,
  ctx?: OutputContext,
): Promise<void> {
  if (pairs.length === 0) {
    throw new UsageError(
      "No variables provided to set.",
      "Specify variables in KEY=VALUE format: `lift env set KEY=VALUE`.",
    );
  }

  const variables: Record<string, string> = {};
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx === -1) {
      throw new UsageError(
        `Invalid variable format '${pair}'. Expected KEY=VALUE.`,
        "Pass variables in KEY=VALUE format: `lift env set KEY=VALUE`.",
      );
    }
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1);
    variables[key] = value;
  }

  const { client } = getAuthenticatedClient(options);
  const projectId = await resolveTargetProject(client, options);
  const serviceId = await resolveTargetService(client, projectId, options);

  const res = await client.variables.upsert(serviceId, { variables });

  if (ctx?.json) {
    printJson(res, ctx);
  } else {
    printText(
      `Set ${Object.keys(variables).join(", ")}. Run \`lift up\` to deploy with updated variables.`,
      ctx,
    );
  }
}

export async function envUnsetCommand(
  keys: string[],
  options: EnvOptions,
  ctx?: OutputContext,
): Promise<void> {
  if (keys.length === 0) {
    throw new UsageError(
      "No variable keys provided to unset.",
      "Specify variable keys to remove: `lift env unset KEY`.",
    );
  }

  const variables: Record<string, null> = {};
  for (const key of keys) {
    variables[key.trim()] = null;
  }

  const { client } = getAuthenticatedClient(options);
  const projectId = await resolveTargetProject(client, options);
  const serviceId = await resolveTargetService(client, projectId, options);

  const res = await client.variables.upsert(serviceId, { variables });

  if (ctx?.json) {
    printJson(res, ctx);
  } else {
    printText(
      `Removed ${Object.keys(variables).join(", ")}. Run \`lift up\` to deploy with updated variables.`,
      ctx,
    );
  }
}
