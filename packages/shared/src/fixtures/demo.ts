import type { DeploymentStatus, ProjectEventType } from "../enums";
import { RuntimeEnv } from "../internal";
import { imageTagFor, postgresNamesFor } from "../jobs";
import { AgentAction } from "../schemas/agent";
import { Database, DatabaseCredentials } from "../schemas/database";
import { Deployment, DeploymentDetail, type DeploymentTimelineEntry } from "../schemas/deployment";
import { Domain } from "../schemas/domain";
import { EditorCommit } from "../schemas/editor";
import { ProjectEvent } from "../schemas/event";
import { ProjectMember } from "../schemas/member";
import { type ProjectBase, ProjectDetail, ProjectListItem } from "../schemas/project";
import { Service } from "../schemas/service";
import { User } from "../schemas/user";
import { maskVariableValue, type StoredVariableSource, Variable } from "../schemas/variable";
import { fixtureCommits as commits, fixtureHex, fixtureId, fixtureIds as ids } from "./ids";

// One demo project, "Demo shop": a Next.js storefront (web) and an Express API (api) on a
// Postgres database. Every object goes through its schema here, so importing a broken fixture
// fails loudly. Timestamps run from Nov 16 to Nov 18, 2026.

const S = ids.services;
const D = ids.deployments;
const host = (subdomain: string) => `${subdomain}.apps.localhost`;
const url = (subdomain: string) => `http://${host(subdomain)}`;

// ── People ────────────────────────────────────────────────────────────────────────────────────

const avatar = (login: string) => `https://github.com/identicons/${login}.png`;

export const users = {
  owner: User.parse({
    id: ids.users.owner,
    githubId: 90_412_871,
    login: "ama-owusu",
    name: "Ama Owusu",
    email: "ama@example.com",
    avatarUrl: avatar("ama-owusu"),
    createdAt: "2026-11-16T09:58:00Z",
  }),
  editor: User.parse({
    id: ids.users.editor,
    githubId: 88_231_450,
    login: "kwame-asante",
    name: "Kwame Asante",
    email: "kwame@example.com",
    avatarUrl: avatar("kwame-asante"),
    createdAt: "2026-11-16T11:20:00Z",
  }),
  viewer: User.parse({
    id: ids.users.viewer,
    githubId: 95_510_332,
    login: "efua-mensah",
    name: "Efua Mensah",
    email: null,
    avatarUrl: avatar("efua-mensah"),
    createdAt: "2026-11-18T08:28:00Z",
  }),
};

/** `GET /me`: the owner. */
export const me = users.owner;

const memberOf = (user: User, role: "owner" | "editor" | "viewer", createdAt: string) =>
  ProjectMember.parse({
    projectId: ids.project,
    userId: user.id,
    role,
    user: { id: user.id, login: user.login, name: user.name, avatarUrl: user.avatarUrl },
    createdAt,
  });

export const members = [
  memberOf(users.owner, "owner", "2026-11-16T10:00:00Z"),
  memberOf(users.editor, "editor", "2026-11-16T11:22:00Z"),
  memberOf(users.viewer, "viewer", "2026-11-18T08:30:00Z"),
];

// ── Deployments ───────────────────────────────────────────────────────────────────────────────

type Commit = (typeof commits)[keyof typeof commits];
type DeploymentFields = Partial<Deployment> &
  Pick<Deployment, "id" | "serviceId" | "status" | "trigger" | "queuedAt">;

function deployment(commit: Commit, fields: DeploymentFields): Deployment {
  return Deployment.parse({
    projectId: ids.project,
    commitSha: commit.sha,
    commitMessage: commit.message,
    commitAuthor: commit.author,
    imageTag: null,
    containerId: null,
    rollbackOf: null,
    errorCode: null,
    errorMessage: null,
    createdByUserId: null,
    createdByActionId: null,
    startedAt: null,
    finishedAt: null,
    createdAt: fields.queuedAt,
    ...fields,
  });
}

const built = (serviceId: string, deploymentId: string) => ({
  imageTag: imageTagFor(serviceId, deploymentId),
  containerId: fixtureHex(`container:${deploymentId}`, 64),
});

const webFirst = deployment(commits.webInitial, {
  id: D.webFirst,
  serviceId: S.web,
  status: "superseded",
  trigger: "push",
  ...built(S.web, D.webFirst),
  queuedAt: "2026-11-16T10:12:00Z",
  startedAt: "2026-11-16T10:12:02Z",
  finishedAt: "2026-11-16T10:14:45Z",
});

const webFailed = deployment(commits.webGrid, {
  id: D.webFailed,
  serviceId: S.web,
  status: "failed",
  trigger: "push",
  errorCode: "build_failed",
  errorMessage: "npm run build exited with code 1: Next.js needs Node.js >=20.9.0 (found 18.20.4)",
  queuedAt: "2026-11-17T14:05:00Z",
  startedAt: "2026-11-17T14:05:02Z",
  finishedAt: "2026-11-17T14:06:10Z",
});

/** Autofix set NODE_VERSION=22 and redeployed the same commit. */
const webActive = deployment(commits.webGrid, {
  id: D.webActive,
  serviceId: S.web,
  status: "active",
  trigger: "agent",
  ...built(S.web, D.webActive),
  createdByActionId: ids.agentActions.setNodeVersion,
  queuedAt: "2026-11-17T14:18:00Z",
  startedAt: "2026-11-17T14:18:02Z",
  finishedAt: "2026-11-17T14:20:12Z",
});

/** Canceled while queued, when the editor deployment after it was queued: newest wins. */
const webCanceled = deployment(commits.webHeroTweak, {
  id: D.webCanceled,
  serviceId: S.web,
  status: "canceled",
  trigger: "manual",
  createdByUserId: ids.users.owner,
  queuedAt: "2026-11-18T08:40:00Z",
  finishedAt: "2026-11-18T08:41:00Z",
});

const webBuilding = deployment(commits.webHero, {
  id: D.webBuilding,
  serviceId: S.web,
  status: "building",
  trigger: "editor",
  createdByUserId: ids.users.editor,
  queuedAt: "2026-11-18T08:41:00Z",
  startedAt: "2026-11-18T08:41:02Z",
});

const webQueued = deployment(commits.webFooter, {
  id: D.webQueued,
  serviceId: S.web,
  status: "queued",
  trigger: "cli",
  createdByUserId: ids.users.owner,
  queuedAt: "2026-11-18T08:42:30Z",
});

const apiFirst = deployment(commits.apiInitial, {
  id: D.apiFirst,
  serviceId: S.api,
  status: "superseded",
  trigger: "manual",
  ...built(S.api, D.apiFirst),
  createdByUserId: ids.users.owner,
  queuedAt: "2026-11-16T10:05:10Z",
  startedAt: "2026-11-16T10:05:12Z",
  finishedAt: "2026-11-16T10:07:20Z",
});

const apiActive = deployment(commits.apiOrders, {
  id: D.apiActive,
  serviceId: S.api,
  status: "active",
  trigger: "push",
  ...built(S.api, D.apiActive),
  queuedAt: "2026-11-17T09:28:00Z",
  startedAt: "2026-11-17T09:28:03Z",
  finishedAt: "2026-11-17T09:31:25Z",
});

/** A rollback skips the build: it starts at `deploying` with its target's image. */
const apiRollback = deployment(commits.apiInitial, {
  id: D.apiRollback,
  serviceId: S.api,
  status: "deploying",
  trigger: "rollback",
  rollbackOf: D.apiFirst,
  imageTag: apiFirst.imageTag,
  createdByUserId: ids.users.owner,
  queuedAt: "2026-11-18T08:43:00Z",
  startedAt: "2026-11-18T08:43:00Z",
});

/** Each service's deployments, newest first, as `GET /services/:id/deployments` lists them. */
export const deployments = {
  web: [webQueued, webBuilding, webCanceled, webActive, webFailed, webFirst],
  api: [apiRollback, apiActive, apiFirst],
};

/** Every deployment in the project, newest first. */
export const allDeployments = [...deployments.web, ...deployments.api].sort((a, b) =>
  b.queuedAt.localeCompare(a.queuedAt),
);

function timeline(
  deploymentId: string,
  steps: Array<[DeploymentStatus, string, string | null]>,
): DeploymentTimelineEntry[] {
  return steps.map(([status, at, message], i) => ({
    id: fixtureId("dpe", `${deploymentId}:${i}`),
    status,
    message,
    at,
  }));
}

const live = (subdomain: string) => `Live at ${url(subdomain)}`;

const timelines: Record<string, DeploymentTimelineEntry[]> = {
  [D.webFirst]: timeline(D.webFirst, [
    ["queued", "2026-11-16T10:12:00Z", "Queued from a push to main"],
    ["building", "2026-11-16T10:12:02Z", "Building with Railpack"],
    ["deploying", "2026-11-16T10:14:20Z", "Image built in 2m 18s"],
    ["active", "2026-11-16T10:14:45Z", live("web-demo-shop")],
    ["superseded", "2026-11-17T14:20:12Z", "Replaced by a newer deployment"],
  ]),
  [D.webFailed]: timeline(D.webFailed, [
    ["queued", "2026-11-17T14:05:00Z", "Queued from a push to main"],
    ["building", "2026-11-17T14:05:02Z", "Building with Railpack"],
    ["failed", "2026-11-17T14:06:10Z", "Build failed: npm run build exited with code 1"],
  ]),
  [D.webActive]: timeline(D.webActive, [
    ["queued", "2026-11-17T14:18:00Z", "Queued by the assistant after setting NODE_VERSION=22"],
    ["building", "2026-11-17T14:18:02Z", "Building with Railpack"],
    ["deploying", "2026-11-17T14:20:05Z", "Image built in 2m 03s"],
    ["active", "2026-11-17T14:20:12Z", live("web-demo-shop")],
  ]),
  [D.webCanceled]: timeline(D.webCanceled, [
    ["queued", "2026-11-18T08:40:00Z", "Queued by ama-owusu"],
    ["canceled", "2026-11-18T08:41:00Z", "Canceled: a newer deployment was queued"],
  ]),
  [D.webBuilding]: timeline(D.webBuilding, [
    ["queued", "2026-11-18T08:41:00Z", "Queued from an editor commit by kwame-asante"],
    ["building", "2026-11-18T08:41:02Z", "Building with Railpack"],
  ]),
  [D.webQueued]: timeline(D.webQueued, [
    ["queued", "2026-11-18T08:42:30Z", "Queued from the CLI by ama-owusu"],
  ]),
  [D.apiFirst]: timeline(D.apiFirst, [
    ["queued", "2026-11-16T10:05:10Z", "Queued when the service was created"],
    ["building", "2026-11-16T10:05:12Z", "Building with Railpack"],
    ["deploying", "2026-11-16T10:06:55Z", "Image built in 1m 43s"],
    ["active", "2026-11-16T10:07:20Z", live("api-demo-shop")],
    ["superseded", "2026-11-17T09:31:25Z", "Replaced by a newer deployment"],
  ]),
  [D.apiActive]: timeline(D.apiActive, [
    ["queued", "2026-11-17T09:28:00Z", "Queued from a push to main"],
    ["building", "2026-11-17T09:28:03Z", "Building with Railpack"],
    ["deploying", "2026-11-17T09:31:00Z", "Image built in 2m 57s"],
    ["active", "2026-11-17T09:31:25Z", live("api-demo-shop")],
  ]),
  [D.apiRollback]: timeline(D.apiRollback, [
    ["deploying", "2026-11-18T08:43:00Z", `Rolling back to ${D.apiFirst}: reusing its image`],
  ]),
};

/** `GET /deployments/:id` for every deployment, by ID. */
export const deploymentDetails: Record<string, DeploymentDetail> = Object.fromEntries(
  allDeployments.map((d) => [d.id, DeploymentDetail.parse({ ...d, timeline: timelines[d.id] })]),
);

// ── Services, database, domains ───────────────────────────────────────────────────────────────

const summary = (d: Deployment) => ({
  id: d.id,
  status: d.status,
  commitSha: d.commitSha,
  createdAt: d.createdAt,
});

const serviceDefaults = {
  projectId: ids.project,
  type: "web",
  rootDir: ".",
  builder: "railpack",
  dockerfilePath: null,
  buildCommand: null,
  cpu: 0.5,
  memoryMb: 512,
  autofix: true,
} as const;

export const services = {
  web: Service.parse({
    ...serviceDefaults,
    id: S.web,
    name: "web",
    slug: "web",
    repo: { owner: "lift-demo", name: "next-hello", branch: "main" },
    startCommand: null,
    port: 3000,
    healthcheckPath: "/",
    subdomain: "web-demo-shop",
    url: url("web-demo-shop"),
    latestDeployment: summary(webQueued),
    activeDeploymentId: webActive.id,
    createdAt: "2026-11-16T10:02:00Z",
  }),
  api: Service.parse({
    ...serviceDefaults,
    id: S.api,
    name: "api",
    slug: "api",
    repo: { owner: "lift-demo", name: "express-postgres", branch: "main" },
    startCommand: "node server.js",
    port: 8080,
    healthcheckPath: "/health",
    subdomain: "api-demo-shop",
    url: url("api-demo-shop"),
    latestDeployment: summary(apiRollback),
    activeDeploymentId: apiActive.id,
    createdAt: "2026-11-16T10:05:00Z",
  }),
};

export const database = Database.parse({
  id: ids.database,
  projectId: ids.project,
  type: "postgres",
  name: "main-db",
  status: "ready",
  host: "lift-pg",
  port: 5432,
  envVar: "DATABASE_URL",
  createdAt: "2026-11-16T10:06:00Z",
});

const pg = postgresNamesFor(ids.database);
const fakePassword = "fixture-password-not-real";

/** `GET /databases/:id/credentials`. The password is obviously fake; fixtures hold no secrets. */
export const databaseCredentials = DatabaseCredentials.parse({
  url: `postgres://${pg.role}:${fakePassword}@lift-pg:5432/${pg.database}`,
  host: "lift-pg",
  port: 5432,
  username: pg.role,
  password: fakePassword,
  database: pg.database,
});

export const domains = [
  Domain.parse({
    id: ids.domains.web,
    serviceId: S.web,
    hostname: host("web-demo-shop"),
    kind: "generated",
    status: "active",
    verifiedAt: null,
    createdAt: "2026-11-16T10:02:00Z",
  }),
  Domain.parse({
    id: ids.domains.api,
    serviceId: S.api,
    hostname: host("api-demo-shop"),
    kind: "generated",
    status: "active",
    verifiedAt: null,
    createdAt: "2026-11-16T10:05:00Z",
  }),
];

const projectBase: ProjectBase = {
  id: ids.project,
  name: "Demo shop",
  slug: "demo-shop",
  ownerId: ids.users.owner,
  createdAt: "2026-11-16T10:00:00Z",
};

/** `GET /projects/:id`, as the owner sees it. */
export const project = ProjectDetail.parse({
  ...projectBase,
  role: "owner",
  services: [services.web, services.api],
  databases: [database],
});

/** One item of `GET /projects`. */
export const projectListItem = ProjectListItem.parse({
  ...projectBase,
  role: "owner",
  services: [
    { id: S.web, name: "web", status: webQueued.status },
    { id: S.api, name: "api", status: apiRollback.status },
  ],
  lastDeployedAt: apiRollback.createdAt,
});

// ── Variables ─────────────────────────────────────────────────────────────────────────────────

function variable(
  service: keyof typeof S,
  key: string,
  value: string,
  source: StoredVariableSource,
  updatedAt: string,
  databaseId: string | null = null,
): Variable {
  return Variable.parse({
    id: fixtureId("var", `${service}:${key}`),
    serviceId: S[service],
    key,
    value,
    source,
    databaseId,
    updatedAt,
    createdAt: updatedAt,
  });
}

/** `GET /services/:id/variables?reveal=true`, sorted by key. Every value is fake. */
export const revealedVariables = {
  web: [
    variable(
      "web",
      "DATABASE_URL",
      databaseCredentials.url,
      "database",
      "2026-11-16T10:06:41Z",
      ids.database,
    ),
    variable("web", "NEXT_PUBLIC_API_URL", url("api-demo-shop"), "user", "2026-11-16T10:20:00Z"),
    variable("web", "NODE_VERSION", "22", "agent", "2026-11-17T14:17:40Z"),
    variable(
      "web",
      "SESSION_SECRET",
      "dev-only-not-a-real-secret-7f3a",
      "user",
      "2026-11-16T10:20:00Z",
    ),
  ],
  api: [
    variable(
      "api",
      "DATABASE_URL",
      databaseCredentials.url,
      "database",
      "2026-11-16T10:06:42Z",
      ids.database,
    ),
    variable("api", "LOG_LEVEL", "info", "user", "2026-11-16T10:05:00Z"),
    variable("api", "NODE_ENV", "production", "user", "2026-11-16T10:05:00Z"),
  ],
};

const masked = (list: Variable[]) => list.map((v) => ({ ...v, value: maskVariableValue(v.value) }));

/** `GET /services/:id/variables`: values masked the way the API masks them. */
export const variables = {
  web: masked(revealedVariables.web),
  api: masked(revealedVariables.api),
};

/** `GET /internal/v1/deployments/:id/runtime-env` for the web service's active deployment. */
export const runtimeEnv = RuntimeEnv.parse({
  deploymentId: webActive.id,
  variables: [
    ...revealedVariables.web.map(({ key, value, source }) => ({ key, value, source })),
    { key: "PORT", value: "3000", source: "system" },
    { key: "LIFT_SERVICE_ID", value: S.web, source: "system" },
    { key: "LIFT_DEPLOYMENT_ID", value: webActive.id, source: "system" },
    { key: "LIFT_PUBLIC_URL", value: url("web-demo-shop"), source: "system" },
  ],
  envHash: fixtureHex(`env:${webActive.id}`, 64),
});

// ── Activity ──────────────────────────────────────────────────────────────────────────────────

const setNodeVersion = AgentAction.parse({
  id: ids.agentActions.setNodeVersion,
  sessionId: ids.agentSessions.autofix,
  projectId: ids.project,
  kind: "autofix",
  tool: "set_variables",
  args: { serviceId: S.web, variables: { NODE_VERSION: "22" } },
  status: "completed",
  requiresApproval: false,
  result: { requiresRedeploy: true },
  createdAt: "2026-11-17T14:17:40Z",
});

const addRedis = AgentAction.parse({
  id: ids.agentActions.addRedis,
  sessionId: ids.agentSessions.chat,
  projectId: ids.project,
  kind: "chat",
  tool: "add_database",
  args: { projectId: ids.project, type: "redis", name: "cache" },
  status: "proposed",
  requiresApproval: true,
  result: null,
  createdAt: "2026-11-18T08:45:00Z",
});

const heroCommit = EditorCommit.parse({
  id: ids.editorCommit,
  serviceId: S.web,
  commitSha: commits.webHero.sha,
  message: commits.webHero.message,
  paths: ["app/page.tsx", "app/components/hero.tsx"],
  authorUserId: ids.users.editor,
  deploymentId: webBuilding.id,
  createdAt: "2026-11-18T08:41:02Z",
});

/** A deployment as it was when it was queued. */
const asQueued = (d: Deployment): Deployment => ({
  ...d,
  status: "queued",
  imageTag: null,
  containerId: null,
  errorCode: null,
  errorMessage: null,
  startedAt: null,
  finishedAt: null,
});

const asNew = (s: Service): Service => ({ ...s, latestDeployment: null, activeDeploymentId: null });

type Actor = [ProjectEvent["actorType"], string | null];

function event(
  type: ProjectEventType,
  createdAt: string,
  actor: Actor,
  data: unknown,
): ProjectEvent {
  return ProjectEvent.parse({
    id: fixtureId("evt", `${createdAt}:${type}`),
    projectId: ids.project,
    actorType: actor[0],
    actorId: actor[1],
    type,
    data,
    createdAt,
  });
}

const owner: Actor = ["user", ids.users.owner];
const editor: Actor = ["user", ids.users.editor];
const worker: Actor = ["worker", null];
const system: Actor = ["system", null];
const agent: Actor = ["agent", ids.agentActions.setNodeVersion];

const history: ProjectEvent[] = [
  event("project.updated", "2026-11-16T10:01:00Z", owner, projectBase),
  event("service.created", "2026-11-16T10:02:00Z", owner, asNew(services.web)),
  event("service.created", "2026-11-16T10:05:00Z", owner, asNew(services.api)),
  event("deployment.created", "2026-11-16T10:05:10Z", owner, asQueued(apiFirst)),
  event("database.status_changed", "2026-11-16T10:06:00Z", owner, {
    ...database,
    status: "provisioning",
    host: null,
    port: null,
    previousStatus: null,
  }),
  event("database.status_changed", "2026-11-16T10:06:40Z", worker, {
    ...database,
    previousStatus: "provisioning",
  }),
  event("variables.changed", "2026-11-16T10:06:41Z", system, {
    serviceId: S.web,
    keys: ["DATABASE_URL"],
  }),
  event("variables.changed", "2026-11-16T10:06:42Z", system, {
    serviceId: S.api,
    keys: ["DATABASE_URL"],
  }),
  event("deployment.status_changed", "2026-11-16T10:07:20Z", worker, {
    ...apiFirst,
    status: "active",
    previousStatus: "deploying",
  }),
  event("member.changed", "2026-11-16T11:22:00Z", owner, {
    ...members[1],
    previousRole: null,
    removed: false,
  }),
  event("deployment.status_changed", "2026-11-17T09:31:25Z", worker, {
    ...apiActive,
    previousStatus: "deploying",
  }),
  event("service.restarted", "2026-11-17T10:00:00Z", owner, {
    ...services.api,
    latestDeployment: summary(apiActive),
  }),
  event("deployment.created", "2026-11-17T14:05:00Z", system, asQueued(webFailed)),
  event("deployment.status_changed", "2026-11-17T14:06:10Z", worker, {
    ...webFailed,
    previousStatus: "building",
  }),
  event("agent.action_completed", "2026-11-17T14:17:40Z", agent, setNodeVersion),
  event("variables.changed", "2026-11-17T14:17:41Z", agent, {
    serviceId: S.web,
    keys: ["NODE_VERSION"],
  }),
  event("deployment.created", "2026-11-17T14:18:00Z", agent, asQueued(webActive)),
  event("deployment.status_changed", "2026-11-17T14:20:12Z", worker, {
    ...webActive,
    previousStatus: "deploying",
  }),
  event("deployment.status_changed", "2026-11-17T14:20:13Z", system, {
    ...webFirst,
    previousStatus: "active",
  }),
  event("member.changed", "2026-11-18T08:30:00Z", owner, {
    ...members[2],
    previousRole: null,
    removed: false,
  }),
  event("deployment.created", "2026-11-18T08:40:00Z", owner, asQueued(webCanceled)),
  event("deployment.created", "2026-11-18T08:41:00Z", editor, asQueued(webBuilding)),
  event("deployment.status_changed", "2026-11-18T08:41:01Z", system, {
    ...webCanceled,
    previousStatus: "queued",
  }),
  event("editor.committed", "2026-11-18T08:41:02Z", editor, heroCommit),
  event("deployment.created", "2026-11-18T08:42:30Z", owner, webQueued),
  event("deployment.created", "2026-11-18T08:43:00Z", owner, apiRollback),
  event("agent.action_proposed", "2026-11-18T08:45:00Z", ["agent", addRedis.id], addRedis),
];

/** `GET /projects/:id/events`: the activity feed, newest first. */
export const events = [...history].reverse();
