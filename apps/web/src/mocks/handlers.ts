import {
  API_BASE_PATH,
  type ApiToken,
  appHostname,
  appUrl,
  CreateDatabaseBody,
  CreatePlanBody,
  CreateProjectBody,
  CreateServiceBody,
  CreateTokenBody,
  type Deployment,
  type DeploymentDetail,
  ID_PREFIXES,
  type LogEntry,
  maskVariableValue,
  newId,
  type OnboardingPlan,
  PROBLEM_CONTENT_TYPE,
  type ProjectDetail,
  type ProjectListItem,
  type Service,
  UpsertVariablesBody,
  type Variable,
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
const projects: ProjectDetail[] = [
  { ...fixtures.project, databases: [...fixtures.project.databases] },
];
/** Plans asked for with mocks on: every repo gets the express-postgres plan, under its own name. */
const plans = new Map<string, OnboardingPlan>([
  [fixtures.onboardingPlan.id, fixtures.onboardingPlan],
]);
/** Variables by service, kept in plaintext; answers mask them unless `?reveal=true`. */
const variablesByService = new Map<string, Variable[]>([
  [fixtures.fixtureIds.services.web, [...fixtures.revealedVariables.web]],
  [fixtures.fixtureIds.services.api, [...fixtures.revealedVariables.api]],
]);
const masked = (variable: Variable): Variable => ({
  ...variable,
  value: maskVariableValue(variable.value),
});

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

  http.get(api("/services/:serviceId/variables"), ({ params, request }) => {
    const reveal = new URL(request.url).searchParams.get("reveal") === "true";
    const stored = variablesByService.get(String(params.serviceId)) ?? [];
    return HttpResponse.json(fixtures.page(reveal ? stored : stored.map(masked)));
  }),
  http.put(api("/services/:serviceId/variables"), async ({ params, request }) => {
    const parsed = UpsertVariablesBody.safeParse(await request.json());
    if (!parsed.success) return invalid(issuesToFields(parsed.error.issues));
    const serviceId = String(params.serviceId);
    const now = new Date().toISOString();
    const stored = new Map(
      (variablesByService.get(serviceId) ?? []).map((variable) => [variable.key, variable]),
    );
    for (const [key, value] of Object.entries(parsed.data.variables)) {
      if (value === null) {
        stored.delete(key);
        continue;
      }
      const before = stored.get(key);
      stored.set(key, {
        id: before?.id ?? newId("var"),
        serviceId,
        key,
        value,
        source: "user",
        databaseId: null,
        updatedAt: now,
        createdAt: before?.createdAt ?? now,
      });
    }
    const next = [...stored.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
    variablesByService.set(serviceId, next);
    return HttpResponse.json({ variables: next.map(masked), requiresRedeploy: true });
  }),
  // Databases are ready at once in mock mode; nothing provisions them.
  http.post(api("/projects/:projectId/databases"), async ({ params, request }) => {
    const project = projects.find((candidate) => candidate.id === params.projectId);
    if (!project) return problem(404, "not_found", "Not found", `No project ${params.projectId}.`);
    const parsed = CreateDatabaseBody.safeParse(await request.json());
    if (!parsed.success) return invalid(issuesToFields(parsed.error.issues));
    if (parsed.data.type !== "postgres") return invalid({ type: "Only postgres is available" });
    if (project.databases.length > 0) {
      return problem(409, "conflict", "Conflict", "This project already has a Postgres database.");
    }
    const created = {
      id: newId("db"),
      projectId: project.id,
      type: "postgres" as const,
      name: parsed.data.name ?? "postgres",
      status: "ready" as const,
      host: "lift-pg",
      port: 5432,
      envVar: "DATABASE_URL",
      createdAt: new Date().toISOString(),
    };
    project.databases.push(created);
    return HttpResponse.json(
      { ...created, status: "provisioning", host: null, port: null },
      { status: 202 },
    );
  }),
  http.get(api("/databases/:databaseId/credentials"), ({ params }) => {
    const found = projects
      .flatMap((project) => project.databases)
      .find((database) => database.id === params.databaseId);
    if (!found) return problem(404, "not_found", "Not found", `No database ${params.databaseId}.`);
    const password = "mock-password-not-real";
    return HttpResponse.json({
      url: `postgres://${found.id}:${password}@lift-pg:5432/${found.id}`,
      host: "lift-pg",
      port: 5432,
      username: found.id,
      password,
      database: found.id,
    });
  }),
  http.delete(api("/databases/:databaseId"), ({ params }) => {
    for (const project of projects) {
      const index = project.databases.findIndex((database) => database.id === params.databaseId);
      const [removed] = index === -1 ? [] : project.databases.splice(index, 1);
      if (removed) return HttpResponse.json({ ...removed, status: "deleting" }, { status: 202 });
    }
    return problem(404, "not_found", "Not found", `No database ${params.databaseId}.`);
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
  // A rollback goes live at once in mock mode: there's no image to run.
  http.post(api("/deployments/:deploymentId/rollback"), ({ params }) => {
    const target = deployments.get(String(params.deploymentId));
    const service = target && findService(target.serviceId);
    if (!target || !service) return problem(404, "not_found", "Not found", "No such deployment.");
    if (target.status !== "superseded" || !target.imageTag) {
      return problem(
        409,
        "conflict",
        "Conflict",
        "Only a deployment that was live can be rolled back to.",
      );
    }
    const now = new Date().toISOString();
    for (const other of deployments.values()) {
      if (other.serviceId === service.id && other.status === "active") other.status = "superseded";
    }
    const id = newId(ID_PREFIXES.deployment);
    const detail: DeploymentDetail = {
      ...target,
      id,
      status: "active",
      trigger: "rollback",
      rollbackOf: target.id,
      createdByUserId: fixtures.me.id,
      queuedAt: now,
      startedAt: now,
      finishedAt: now,
      createdAt: now,
      timeline: [
        {
          id: newId(ID_PREFIXES.deploymentEvent),
          status: "deploying",
          message: `Rolling back to ${target.commitSha.slice(0, 7)}`,
          at: now,
        },
        { id: newId(ID_PREFIXES.deploymentEvent), status: "active", message: null, at: now },
      ],
    };
    deployments.set(id, detail);
    service.latestDeployment = {
      id,
      status: "active",
      commitSha: detail.commitSha,
      createdAt: now,
    };
    service.activeDeploymentId = id;
    return HttpResponse.json(withoutTimeline(detail), { status: 202 });
  }),
  http.post(api("/deployments/:deploymentId/cancel"), ({ params }) => {
    const deployment = deployments.get(String(params.deploymentId));
    if (!deployment) return problem(404, "not_found", "Not found", "No such deployment.");
    if (deployment.status !== "queued" && deployment.status !== "building") {
      return problem(
        409,
        "conflict",
        "Conflict",
        `This deployment is ${deployment.status}; only a queued or building one can be canceled.`,
      );
    }
    const now = new Date().toISOString();
    deployment.status = "canceled";
    deployment.finishedAt = now;
    deployment.timeline.push({
      id: newId(ID_PREFIXES.deploymentEvent),
      status: "canceled",
      message: `Canceled by ${fixtures.me.login}`,
      at: now,
    });
    return HttpResponse.json(withoutTimeline(deployment));
  }),
  http.post(api("/services/:serviceId/restart"), ({ params }) => {
    const service = findService(String(params.serviceId));
    if (!service) return problem(404, "not_found", "Not found", "No service with that ID.");
    if (!service.activeDeploymentId) {
      return problem(
        409,
        "conflict",
        "Conflict",
        `${service.name} has nothing running to restart.`,
      );
    }
    return HttpResponse.json(service, { status: 202 });
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
  // FE-16: the demo's failed web build has autofix's diagnosis; other deployments have none.
  http.get(api("/deployments/:deploymentId/diagnosis"), ({ params }) =>
    params.deploymentId === fixtures.diagnosis.deploymentId
      ? HttpResponse.json(fixtures.diagnosis)
      : problem(404, "not_found", "Not found", "This deployment has no diagnosis yet."),
  ),
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
  // FE-14: the assistant's plan takes a moment, then answers the fixture plan for the repo asked.
  http.post(api("/agent/plans"), async ({ request }) => {
    const body = CreatePlanBody.parse(await request.json());
    await pause(1_500);
    const plan: OnboardingPlan = {
      ...fixtures.onboardingPlan,
      id: newId("pln"),
      repo: {
        ...fixtures.onboardingPlan.repo,
        owner: body.owner,
        name: body.repo,
        branch: body.branch ?? fixtures.onboardingPlan.repo.branch,
      },
    };
    plans.set(plan.id, plan);
    return HttpResponse.json(plan, { status: 201 });
  }),
  http.get(api("/agent/plans/:planId"), ({ params }) => {
    const plan = plans.get(String(params.planId));
    return plan
      ? HttpResponse.json(plan)
      : problem(404, "not_found", "Not found", "No plan with that ID.");
  }),
  // Applying lands on the demo project's web service, whose latest deployment exists.
  http.post(api("/agent/plans/:planId/apply"), async ({ params }) => {
    if (!plans.has(String(params.planId))) {
      return problem(404, "not_found", "Not found", "No plan with that ID.");
    }
    await pause(600);
    return HttpResponse.json(
      { project: projects[0], serviceId: fixtures.fixtureIds.services.web },
      { status: 201 },
    );
  }),
  // Nothing happens on its own in mock mode, so the project stream only sends heartbeats.
  http.get(api("/projects/:projectId/events/stream"), ({ request }) =>
    eventStream(request.signal, (send) => heartbeats(request.signal, send)),
  ),
];
