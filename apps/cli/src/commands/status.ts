import type { Service } from "@lift/shared";
import { getAuthenticatedClient } from "../client";
import { loadProjectLink } from "../config";
import { CliError, UsageError } from "../errors";
import { type OutputContext, printJson, printText, renderTable } from "../output";

export interface StatusOptions {
  apiUrl?: string;
  configDir?: string;
  project?: string;
  service?: string;
  cwd?: string;
}

export async function statusCommand(options: StatusOptions, ctx?: OutputContext): Promise<void> {
  const { client } = getAuthenticatedClient(options);

  let projectId = options.project;

  if (!projectId) {
    const link = loadProjectLink(options.cwd);
    if (link?.projectId) {
      projectId = link.projectId;
    }
  }

  if (!projectId) {
    const projectsPage = await client.projects.list({ limit: 10 });
    if (projectsPage.data.length === 0) {
      throw new CliError(
        "No projects found.",
        1,
        "Create a project on the dashboard or run `lift link` to link an existing project.",
      );
    }
    const firstProject = projectsPage.data[0];
    if (projectsPage.data.length === 1 && firstProject) {
      projectId = firstProject.id;
    } else {
      throw new UsageError(
        "Multiple projects found. Please specify one with --project <name>.",
        "Run `lift status --project <projectIdOrName>` or run `lift link`.",
      );
    }
  }

  // If projectId is a name or slug rather than an ID, resolve it by paginating through projects
  if (!projectId.startsWith("prj_")) {
    let cursor: string | undefined;
    let resolvedId: string | undefined;
    do {
      const projectsPage = await client.projects.list({ limit: 50, cursor });
      const match = projectsPage.data.find(
        (p) => p.slug === projectId || p.name.toLowerCase() === projectId?.toLowerCase(),
      );
      if (match) {
        resolvedId = match.id;
        break;
      }
      cursor = projectsPage.nextCursor ?? undefined;
    } while (cursor);

    if (resolvedId) {
      projectId = resolvedId;
    } else {
      throw new CliError(
        `Project '${projectId}' not found.`,
        1,
        "Run `lift status` without --project to view linked project services or check the project name on the dashboard.",
      );
    }
  }

  const servicesPage = await client.services.list(projectId, { limit: 100 });
  let services = servicesPage.data;

  const targetService = options.service;
  if (targetService) {
    services = services.filter(
      (s) =>
        s.id === targetService ||
        s.name.toLowerCase() === targetService.toLowerCase() ||
        s.slug.toLowerCase() === targetService.toLowerCase(),
    );
    if (services.length === 0) {
      throw new CliError(
        `Service '${targetService}' not found.`,
        1,
        "Run `lift status` to view all services in this project.",
      );
    }
  }

  if (ctx?.json) {
    printJson(services, ctx);
    return;
  }

  if (services.length === 0) {
    printText("No services found in this project.", ctx);
    return;
  }

  const headers = ["NAME", "STATUS", "URL", "LAST DEPLOY"];
  const rows = services.map((s: Service) => [
    s.name,
    s.latestDeployment?.status ?? "none",
    s.url,
    s.latestDeployment?.createdAt ?? "never",
  ]);

  printText(renderTable(headers, rows), ctx);
}
