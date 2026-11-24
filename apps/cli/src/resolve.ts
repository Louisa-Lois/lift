import type { LiftClient } from "@lift/shared";
import { loadProjectLink } from "./config";
import { CliError, UsageError } from "./errors";

export async function resolveTargetProject(
  client: LiftClient,
  options: { project?: string; cwd?: string },
): Promise<string> {
  let projectId = options.project;

  if (!projectId) {
    const link = loadProjectLink(options.cwd);
    if (link?.projectId) {
      projectId = link.projectId;
    }
  }

  if (!projectId) {
    const projectsPage = await client.projects.list({ limit: 50 });
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
        "Run your command with --project <projectIdOrName> or run `lift link`.",
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
        "Check the project name on the dashboard or run `lift status` without --project.",
      );
    }
  }

  return projectId;
}

export async function resolveTargetService(
  client: LiftClient,
  projectId: string,
  options: { service?: string; cwd?: string },
): Promise<string> {
  let serviceId = options.service;

  if (!serviceId) {
    const link = loadProjectLink(options.cwd);
    if (link?.serviceId) {
      serviceId = link.serviceId;
    }
  }

  const servicesPage = await client.services.list(projectId, { limit: 100 });
  const services = servicesPage.data;
  if (services.length === 0) {
    throw new CliError(
      "No services found in this project.",
      1,
      "Create a service on the dashboard or run `lift link`.",
    );
  }

  if (!serviceId) {
    const firstService = services[0];
    if (firstService) {
      return firstService.id;
    }
    throw new CliError(
      "No services found in this project.",
      1,
      "Create a service on the dashboard or run `lift link`.",
    );
  }

  // Match by id, slug, or name
  const match = services.find(
    (s) =>
      s.id === serviceId ||
      s.slug.toLowerCase() === serviceId?.toLowerCase() ||
      s.name.toLowerCase() === serviceId?.toLowerCase(),
  );

  if (match) {
    return match.id;
  }

  throw new CliError(
    `Service '${serviceId}' not found.`,
    1,
    "Run `lift status` to view all services in this project.",
  );
}
