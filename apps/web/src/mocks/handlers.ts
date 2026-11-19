import {
  API_BASE_PATH,
  type ApiToken,
  appHostname,
  appUrl,
  CreateProjectBody,
  CreateServiceBody,
  CreateTokenBody,
  type Deployment,
  type DeploymentDetail,
  ID_PREFIXES,
  type LogEntry,
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
/** Personal tokens; a created one is listed without its plaintext, as the API does. */
const tokens: ApiToken[] = [...fixtures.apiTokens];

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

// ── Deployments and streams ─────────────────────────────────────────────────────────────────

const deployments = new Map<string, DeploymentDetail>(Object.entries(fixtures.deploymentDetails));
const startedHere = new Set<string>();
const encoder = new TextEncoder();
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const findService = (serviceId: string): Service | undefined =>
  projects.flatMap((project) => project.services).find((service) => service.id === serviceId);

function withoutTimeline({ timeline: _timeline, ...deployment }: DeploymentDetail): Deployment {
  return deployment;
}

/** A deployment that "builds" for as long as its log takes to replay, then goes active. */
function startDeployment(service: Service): DeploymentDetail {
  const now = new Date().toISOString();
  const id = newId(ID_PREFIXES.deployment);
  const commitSha = fixtures.deployments.web[0]?.commitSha ?? "0".repeat(40);
  const detail: DeploymentDetail = {
    id,
    serviceId: service.id,
    projectId: service.projectId,
    status: "building",
    trigger: "manual",
    commitSha,
    commitMessage: "Deploy from the mock API",
    commitAuthor: fixtures.me.login,
    imageTag: null,
    containerId: null,
    rollbackOf: null,
    errorCode: null,
    errorMessage: null,
    createdByUserId: fixtures.me.id,
    createdByActionId: null,
    queuedAt: now,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    timeline: [
      { id: newId(ID_PREFIXES.deploymentEvent), status: "queued", message: null, at: now },
      { id: newId(ID_PREFIXES.deploymentEvent), status: "building", message: null, at: now },
    ],
  };
  deployments.set(id, detail);
  startedHere.add(id);
  service.latestDeployment = { id, status: "building", commitSha, createdAt: now };
  return detail;
}

function finishDeployment(id: string): void {
  const detail = deployments.get(id);
  const service = detail && findService(detail.serviceId);
  if (!detail || !service || detail.status !== "building") return;
  const now = new Date().toISOString();
  detail.status = "active";
  detail.finishedAt = now;
  detail.imageTag = `lift/${detail.serviceId}:${id}`;
  detail.containerId = "mock-container";
  detail.timeline.push(
    { id: newId(ID_PREFIXES.deploymentEvent), status: "deploying", message: null, at: now },
    { id: newId(ID_PREFIXES.deploymentEvent), status: "active", message: null, at: now },
  );
  service.latestDeployment = {
    id,
    status: "active",
    commitSha: detail.commitSha,
    createdAt: detail.createdAt,
  };
  service.activeDeploymentId = id;
}

const logOf = (id: string): LogEntry[] =>
  fixtures.deploymentLogs[id] ?? (startedHere.has(id) ? fixtures.buildLog : []);

const afterId = (id: string, after: string | null) => {
  if (!after) return true;
  const [ms = 0, seq = 0] = id.split("-").map(Number);
  const [afterMs = 0, afterSeq = 0] = after.split("-").map(Number);
  return ms > afterMs || (ms === afterMs && seq > afterSeq);
};

/** Server-Sent Events from a script: `run` writes frames until it returns. */
function eventStream(signal: AbortSignal, run: (send: (frame: string) => void) => Promise<void>) {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (frame: string) => {
        if (!signal.aborted) controller.enqueue(encoder.encode(frame));
      };
      send(": connected\n\n");
      await run(send);
      if (!signal.aborted) controller.close();
    },
  });
  return new HttpResponse(body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" },
  });
}

/** Keeps a stream open with heartbeats until the client leaves. */
const heartbeats = (signal: AbortSignal, send: (frame: string) => void) =>
  new Promise<void>((resolve) => {
    const timer = setInterval(() => send(": heartbeat\n\n"), 15_000);
    signal.addEventListener("abort", () => {
      clearInterval(timer);
      resolve();
    });
  });

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
    if (body.data.deploy) startDeployment(service);
    return HttpResponse.json(service, { status: 201 });
  }),

  http.get(api("/tokens"), () => HttpResponse.json(fixtures.page(tokens))),
  http.post(api("/tokens"), async ({ request }) => {
    const parsed = CreateTokenBody.safeParse(await request.json());
    if (!parsed.success) return invalid(issuesToFields(parsed.error.issues));
    // A made-up token in the real format: lift_pat_ and 32 characters.
    const token = `lift_pat_${newId("tok").slice(4)}mockmock`;
    const { projectId: _projectId, ...body } = parsed.data;
    const { token: _fixturePlaintext, ...template } = fixtures.createdApiToken;
    const listed: ApiToken = {
      ...template,
      ...body,
      id: newId("tok"),
      prefix: token.slice(0, 12),
      createdAt: new Date().toISOString(),
    };
    tokens.unshift(listed);
    return HttpResponse.json({ ...listed, token }, { status: 201 });
  }),
  http.delete(api("/tokens/:tokenId"), ({ params }) => {
    const token = tokens.find((candidate) => candidate.id === params.tokenId);
    if (!token) return problem(404, "not_found", "Not found", `No token ${params.tokenId}.`);
    token.revokedAt ??= new Date().toISOString();
    return new HttpResponse(null, { status: 204 });
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

  http.get(api("/services/:serviceId"), ({ params }) => {
    const service = findService(String(params.serviceId));
    return service
      ? HttpResponse.json(service)
      : problem(404, "not_found", "Not found", "No service with that ID.");
  }),
  http.get(api("/services/:serviceId/deployments"), ({ params, request }) => {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
    const list = [...deployments.values()]
      .filter((deployment) => deployment.serviceId === params.serviceId)
      .sort((a, b) => b.queuedAt.localeCompare(a.queuedAt))
      .map(withoutTimeline);
    return HttpResponse.json(fixtures.page(list.slice(0, limit)));
  }),
  http.post(api("/services/:serviceId/deployments"), ({ params }) => {
    const service = findService(String(params.serviceId));
    if (!service) return problem(404, "not_found", "Not found", "No service with that ID.");
    return HttpResponse.json(withoutTimeline(startDeployment(service)), { status: 202 });
  }),
  http.get(api("/deployments/:deploymentId"), ({ params }) => {
    const detail = deployments.get(String(params.deploymentId));
    return detail
      ? HttpResponse.json(detail)
      : problem(404, "not_found", "Not found", "No deployment with that ID.");
  }),
  http.get(api("/deployments/:deploymentId/logs"), ({ params, request }) => {
    const tail = Number(new URL(request.url).searchParams.get("tail") ?? 500);
    return HttpResponse.json({ data: logOf(String(params.deploymentId)).slice(-tail) });
  }),
  // Replays the deployment's fixture log a line every 12 ms; one started here then goes active.
  http.get(api("/deployments/:deploymentId/logs/stream"), ({ params, request }) => {
    const id = String(params.deploymentId);
    const detail = deployments.get(id);
    if (!detail) return problem(404, "not_found", "Not found", "No deployment with that ID.");
    const after = request.headers.get("last-event-id");
    return eventStream(request.signal, async (send) => {
      for (const { id: entryId, ...line } of logOf(id)) {
        if (!afterId(entryId, after)) continue;
        if (request.signal.aborted) return;
        send(`id: ${entryId}\nevent: log\ndata: ${JSON.stringify(line)}\n\n`);
        await pause(12);
      }
      if (startedHere.has(id)) finishDeployment(id);
      const status = deployments.get(id)?.status ?? "active";
      if (status === "queued" || status === "building" || status === "deploying") {
        await heartbeats(request.signal, send);
        return;
      }
      send(`event: end\ndata: ${JSON.stringify({ status })}\n\n`);
    });
  }),
  // Nothing happens on its own in mock mode, so the project stream only sends heartbeats.
  http.get(api("/projects/:projectId/events/stream"), ({ request }) =>
    eventStream(request.signal, (send) => heartbeats(request.signal, send)),
  ),
];
