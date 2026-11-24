import { execSync } from "node:child_process";
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

function getGitRemoteRepo(cwd = process.cwd()): { owner: string; name: string } | null {
  try {
    const remoteUrl = execSync("git remote get-url origin", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/i);
    if (match?.[1] && match[2]) {
      return { owner: match[1], name: match[2] };
    }
  } catch {
    // Ignore git error
  }
  return null;
}

export async function linkCommand(options: LinkOptions, ctx?: OutputContext): Promise<void> {
  const { client } = getAuthenticatedClient(options);

  if (!options.project || !options.service) {
    const remoteRepo = getGitRemoteRepo(options.cwd);
    if (remoteRepo) {
      const projectsPage = await client.projects.list({ limit: 50 });
      const candidates: Array<{
        project: { id: string; name: string };
        service: { id: string; name: string };
      }> = [];

      for (const p of projectsPage.data) {
        if (options.project && p.id !== options.project && p.slug !== options.project) {
          continue;
        }
        const sPage = await client.services.list(p.id, { limit: 50 });
        for (const s of sPage.data) {
          if (
            options.service &&
            s.id !== options.service &&
            s.slug !== options.service &&
            s.name !== options.service
          ) {
            continue;
          }
          if (
            s.repo &&
            s.repo.owner.toLowerCase() === remoteRepo.owner.toLowerCase() &&
            s.repo.name.toLowerCase() === remoteRepo.name.toLowerCase()
          ) {
            candidates.push({ project: p, service: s });
          }
        }
      }

      if (candidates.length === 1 && candidates[0]) {
        const { project, service } = candidates[0];
        saveProjectLink({ projectId: project.id, serviceId: service.id }, options.cwd);
        if (ctx?.json) {
          printJson(
            {
              projectId: project.id,
              serviceId: service.id,
              projectName: project.name,
              serviceName: service.name,
            },
            ctx,
          );
        } else {
          printText(`Linked to project ${project.name} and service ${service.name}.`, ctx);
        }
        return;
      }
    }
  }

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
