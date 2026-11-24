import { getAuthenticatedClient } from "../client";
import { UsageError } from "../errors";
import { type OutputContext, printJson, printText, renderTable } from "../output";
import { resolveTargetProject } from "../resolve";

export interface DbOptions {
  apiUrl?: string;
  configDir?: string;
  project?: string;
  cwd?: string;
}

export async function dbListCommand(options: DbOptions, ctx?: OutputContext): Promise<void> {
  const { client } = getAuthenticatedClient(options);
  const projectId = await resolveTargetProject(client, options);

  const databasesPage = await client.databases.list(projectId);

  if (ctx?.json) {
    printJson(databasesPage.data, ctx);
    return;
  }

  if (databasesPage.data.length === 0) {
    printText("No databases found in this project.", ctx);
    return;
  }

  const headers = ["NAME", "TYPE", "STATUS", "HOST"];
  const rows = databasesPage.data.map((db) => [db.name, db.type, db.status, db.host ?? "-"]);
  printText(renderTable(headers, rows), ctx);
}

export async function dbAddCommand(
  type: string,
  options: DbOptions,
  ctx?: OutputContext,
): Promise<void> {
  const normalizedType = type?.trim().toLowerCase();
  if (normalizedType !== "postgres") {
    throw new UsageError(
      `Unsupported database type '${type}'. Only 'postgres' is supported.`,
      "Run `lift db add postgres`.",
    );
  }

  const { client } = getAuthenticatedClient(options);
  const projectId = await resolveTargetProject(client, options);

  const database = await client.databases.create(projectId, {
    type: "postgres",
  });

  if (ctx?.json) {
    printJson(database, ctx);
  } else {
    printText(
      `Added postgres database '${database.name}'. Status: ${database.status}. DATABASE_URL will be provided once ready.`,
      ctx,
    );
  }
}
