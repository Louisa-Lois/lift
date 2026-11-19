import {
  API_BASE_PATH,
  appHostname,
  appUrl,
  CreateProjectBody,
  CreateServiceBody,
  ID_PREFIXES,
  newId,
  PROBLEM_CONTENT_TYPE,
  type ProjectDetail,
  type ProjectListItem,
  type Service,
} from "@lift/shared";
import * as fixtures from "@lift/shared/fixtures";
import { HttpResponse, http } from "msw";

const api = (path: string) => `${API_BASE_PATH}${path}`;
const APPS_DOMAIN = "apps.localhost";

/**
 * Mock API answers built from @lift/shared/fixtures, so screens work before their routes exist.
 * Each screen's task adds the handlers it needs; requests without one go to the real API.
 * Projects and services created with mocks on live in memory until the page reloads.
 */
const projects: ProjectDetail[] = [fixtures.project];

function problem(status: number, code: string, title: string, detail: string) {
  return HttpResponse.json(
    { type: "about:blank", title, status, detail, code },
    { status, headers: { "content-type": PROBLEM_CONTENT_TYPE } },
  );
}

function invalid(fields: Record<string, string>) {
  return HttpResponse.json(
    {
      type: "about:blank",
      title: "Some fields need fixing",
      status: 422,
      detail: "Check the highlighted fields.",
      code: "validation_failed",
      fields,
    },
    { status: 422, headers: { "content-type": PROBLEM_CONTENT_TYPE } },
  );
}

function issuesToFields(issues: { path: PropertyKey[]; message: string }[]) {
  return Object.fromEntries(issues.map((issue) => [issue.path.join("."), issue.message]));
}

/** Like the API's slugs: lowercase letters, digits and hyphens, 3 to 32 characters. */
function slugFor(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
  return base.length >= 3 ? base : `${base || "app"}-app`;
}

function toListItem(project: ProjectDetail): ProjectListItem {
  const { services, databases: _databases, ...base } = project;
  const deployed = services.flatMap((service) =>
    service.latestDeployment ? [service.latestDeployment.createdAt] : [],
  );
  return {
    ...base,
    services: services.map((service) => ({
      id: service.id,
      name: service.name,
      status: service.latestDeployment?.status ?? null,
    })),
    lastDeployedAt: deployed.sort().at(-1) ?? null,
  };
}

export const handlers = [
  http.get(api("/health"), () => HttpResponse.json({ status: "ok" })),
  http.get(api("/me"), () => HttpResponse.json(fixtures.me)),
  http.post(api("/auth/logout"), () => new HttpResponse(null, { status: 204 })),

  http.get(api("/projects"), () => HttpResponse.json(fixtures.page(projects.map(toListItem)))),
  http.post(api("/projects"), async ({ request }) => {
    const body = CreateProjectBody.safeParse(await request.json());
    if (!body.success) return invalid(issuesToFields(body.error.issues));
    const project: ProjectDetail = {
      id: newId(ID_PREFIXES.project),
      name: body.data.name,
      slug: slugFor(body.data.name),
      ownerId: fixtures.me.id,
      createdAt: new Date().toISOString(),
      role: "owner",
      services: [],
      databases: [],
    };
    projects.unshift(project);
    return HttpResponse.json(project, { status: 201 });
  }),
  http.get(api("/projects/:projectId"), ({ params }) => {
    const project = projects.find((candidate) => candidate.id === params.projectId);
    return project
      ? HttpResponse.json(project)
      : problem(404, "not_found", "Not found", "No project with that ID, or you aren't a member.");
  }),
  http.post(api("/projects/:projectId/services"), async ({ params, request }) => {
    const project = projects.find((candidate) => candidate.id === params.projectId);
    if (!project) {
      return problem(
        404,
        "not_found",
        "Not found",
        "No project with that ID, or you aren't a member.",
      );
    }
    const body = CreateServiceBody.safeParse(await request.json());
    if (!body.success) return invalid(issuesToFields(body.error.issues));
    const { name, repo, branch } = body.data;
    if (!fixtures.githubBranches[`${repo.owner}/${repo.name}`]?.some((b) => b.name === branch)) {
      return invalid({ branch: `${repo.owner}/${repo.name} has no branch called ${branch}` });
    }
    const slug = slugFor(name);
    const subdomain = `${slug}-${project.slug}`.slice(0, 63).replace(/-+$/, "");
    const service: Service = {
      id: newId(ID_PREFIXES.service),
      projectId: project.id,
      name,
      slug,
      type: "web",
      repo: { ...repo, branch },
      rootDir: body.data.rootDir ?? ".",
      builder: body.data.builder ?? "railpack",
      dockerfilePath: null,
      buildCommand: null,
      startCommand: null,
      port: body.data.port ?? 3000,
      healthcheckPath: "/",
      cpu: 0.5,
      memoryMb: 512,
      subdomain,
      autofix: true,
      url: appUrl(appHostname(subdomain, APPS_DOMAIN), APPS_DOMAIN),
      latestDeployment: null,
      activeDeploymentId: null,
      createdAt: new Date().toISOString(),
    };
    project.services.push(service);
    return HttpResponse.json(service, { status: 201 });
  }),

  http.get(api("/github/repos"), ({ request }) => {
    const search = new URL(request.url).searchParams;
    const query = (search.get("query") ?? "").trim().toLowerCase();
    const limit = Number(search.get("limit") ?? 20);
    const matches = fixtures.githubRepos.filter((repo) =>
      `${repo.owner}/${repo.name}`.toLowerCase().includes(query),
    );
    return HttpResponse.json(fixtures.page(matches.slice(0, limit)));
  }),
  http.get(api("/github/repos/:owner/:repo/branches"), ({ params }) => {
    const branches = fixtures.githubBranches[`${params.owner}/${params.repo}`];
    return branches
      ? HttpResponse.json(fixtures.page(branches))
      : problem(
          502,
          "github_error",
          "GitHub refused the request",
          "That repo doesn't exist, or your GitHub account can't read it.",
        );
  }),
];
