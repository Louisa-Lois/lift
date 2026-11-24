import { randomBytes } from "node:crypto";
import { schema } from "@lift/db";
import { createTestDatabase, type TestDatabase } from "@lift/db/testing";
import {
  AGENT_USER_HEADER,
  type AgentPlanRequest,
  type AgentPlanResponse,
  API_BASE_PATH,
  ApplyPlanResponse,
  OnboardingPlan,
  Problem,
  REDIS_STREAMS,
  User,
} from "@lift/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSecretBox } from "../src/services/crypto";
import { buildTestApp, TEST_AGENT_TOKEN, TEST_ENCRYPTION_KEY } from "./helpers/app";
import { fakeGithub } from "./helpers/github";
import { as, signIn } from "./helpers/session";

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const MAIN_SHA = "3f9c2a1b7d4e5f60718293a4b5c6d7e8f9012345";
/** The fake repo's `dev` head: a commit that isn't `main`'s head. */
const DEV_SHA = "a".repeat(40);
const queuePrefix = `test-${randomBytes(4).toString("hex")}`;
const secretBox = createSecretBox(TEST_ENCRYPTION_KEY);
const TYPED = "sk_test_typed_by_the_user_123";

/** What the agent service would answer for a repo: one Express service with Postgres. */
function planFor(request: AgentPlanRequest): AgentPlanResponse {
  return {
    repo: {
      owner: request.owner,
      name: request.repo,
      branch: request.branch,
      commitSha: request.commitSha,
    },
    summary: "An Express API with Postgres.",
    framework: "express",
    services: [
      {
        name: "api",
        rootDir: ".",
        type: "web",
        builder: "railpack",
        buildCommand: null,
        startCommand: "node server.js",
        port: 3000,
        healthcheckPath: "/health",
        rationale: "server.js listens on PORT.",
      },
    ],
    databases: [{ type: "postgres", name: "notes-db", envVar: "DATABASE_URL", rationale: "pg" }],
    variables: [
      {
        service: "api",
        key: "DATABASE_URL",
        source: "database",
        required: true,
        description: "DB",
      },
      {
        service: "api",
        key: "SESSION_SECRET",
        source: "generated",
        required: true,
        description: "Cookies",
      },
      {
        service: "api",
        key: "NODE_ENV",
        source: "default",
        value: "production",
        required: false,
        description: "Mode",
      },
      {
        service: "api",
        key: "STRIPE_SECRET_KEY",
        source: "user",
        required: true,
        description: "Stripe",
      },
      { service: "api", key: "SENTRY_DSN", source: "user", required: false, description: "Errors" },
    ],
    warnings: [],
    confidence: "high",
  };
}

interface AgentCall {
  url: string;
  headers: Headers;
  body: AgentPlanRequest;
}

/** Answers like the agent service; `next` can replace one answer. */
const agent: {
  calls: AgentCall[];
  next: null | (() => Promise<Response>);
  fetch: typeof globalThis.fetch;
} = {
  calls: [],
  next: null,
  fetch: (async (input, init) => {
    const request = new Request(input, init);
    const body = (await request.json()) as AgentPlanRequest;
    agent.calls.push({ url: request.url, headers: request.headers, body });
    const next = agent.next;
    agent.next = null;
    return next ? next() : Response.json(planFor(body));
  }) as typeof globalThis.fetch,
};

const problemResponse = (status: number, code: string, detail: string) =>
  new Response(JSON.stringify({ type: "about:blank", title: "x", status, detail, code }), {
    status,
    headers: { "content-type": "application/problem+json" },
  });

let database: TestDatabase;
let app: TestApp;
let session: string;
let userId: string;
const others: TestApp[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  app = await buildTestApp(
    database,
    {},
    { githubFetch: fakeGithub().fetch, agentFetch: agent.fetch, queuePrefix },
  );
  session = await signIn(app);
  userId = User.parse((await call("GET", "/me")).json()).id;
}, 60_000);

afterAll(async () => {
  for (const other of others) await other.close();
  if (app) {
    for (const queue of Object.values(app.queues)) await queue.obliterate({ force: true });
    await app.close();
  }
  await database?.drop();
});

function call(
  method: "GET" | "POST",
  url: string,
  payload?: object,
  credentials: object = as(session),
) {
  return app.inject({
    method,
    url: `${API_BASE_PATH}${url}`,
    ...credentials,
    ...(payload ? { payload } : {}),
  });
}

async function newPlan(): Promise<OnboardingPlan> {
  const response = await call("POST", "/agent/plans", {
    owner: "lift-demo",
    repo: "express-postgres",
  });
  expect(response.statusCode).toBe(201);
  return OnboardingPlan.parse(response.json());
}

const apply = (planId: string, body: object) => call("POST", `/agent/plans/${planId}/apply`, body);
const typedStripe = [{ service: "api", key: "STRIPE_SECRET_KEY", value: TYPED }];

async function projectsOfUser() {
  return database.db
    .select({ id: schema.projects.id, deletedAt: schema.projects.deletedAt })
    .from(schema.projects)
    .where(eq(schema.projects.ownerId, userId));
}

describe("POST /agent/plans", () => {
  it("asks the agent for the default branch's head, as the user, and stores the plan as a draft", async () => {
    agent.calls.length = 0;
    const plan = await newPlan();
    expect(plan.id).toMatch(/^pln_/);
    expect(plan.repo).toEqual({
      owner: "lift-demo",
      name: "express-postgres",
      branch: "main",
      commitSha: MAIN_SHA,
    });
    const [sent] = agent.calls;
    expect(sent?.url).toBe("http://localhost:4100/plans");
    expect(sent?.headers.get("authorization")).toBe(`Bearer ${TEST_AGENT_TOKEN}`);
    expect(sent?.headers.get(AGENT_USER_HEADER)).toBe(userId);
    expect(sent?.body).toEqual({
      owner: "lift-demo",
      repo: "express-postgres",
      branch: "main",
      commitSha: MAIN_SHA,
    });
    const [row] = await database.db
      .select()
      .from(schema.onboardingPlans)
      .where(eq(schema.onboardingPlans.id, plan.id));
    expect(row).toMatchObject({ userId, status: "draft", commitSha: MAIN_SHA, projectId: null });
    expect(OnboardingPlan.parse(row?.plan)).toEqual(plan);
  });

  it("checks the repo and the branch before asking the agent", async () => {
    agent.calls.length = 0;
    const missing = await call("POST", "/agent/plans", { owner: "lift-demo", repo: "secret" });
    expect(missing.statusCode).toBe(404);
    const branch = await call("POST", "/agent/plans", {
      owner: "lift-demo",
      repo: "express-postgres",
      branch: "nope",
    });
    expect(Problem.parse(branch.json())).toMatchObject({
      code: "validation_failed",
      fields: { branch: "No such branch" },
    });
    expect(agent.calls).toHaveLength(0);
  });

  it("plans the commit it's given, and keeps the branch the service will follow", async () => {
    agent.calls.length = 0;
    const atCommit = await call("POST", "/agent/plans", {
      owner: "lift-demo",
      repo: "express-postgres",
      commitSha: DEV_SHA,
    });
    expect(atCommit.statusCode).toBe(201);
    const plan = OnboardingPlan.parse(atCommit.json());
    expect(plan.repo).toEqual({
      owner: "lift-demo",
      name: "express-postgres",
      branch: "main",
      commitSha: DEV_SHA,
    });
    expect(agent.calls[0]?.body).toEqual({
      owner: "lift-demo",
      repo: "express-postgres",
      branch: "main",
      commitSha: DEV_SHA,
    });
    const [row] = await database.db
      .select({ commitSha: schema.onboardingPlans.commitSha })
      .from(schema.onboardingPlans)
      .where(eq(schema.onboardingPlans.id, plan.id));
    expect(row?.commitSha).toBe(DEV_SHA);

    const onBranch = await call("POST", "/agent/plans", {
      owner: "lift-demo",
      repo: "express-postgres",
      branch: "dev",
      commitSha: MAIN_SHA,
    });
    expect(OnboardingPlan.parse(onBranch.json()).repo).toMatchObject({
      branch: "dev",
      commitSha: MAIN_SHA,
    });
  });

  it("checks a commit it's given, and the branch, before asking the agent", async () => {
    agent.calls.length = 0;
    const body = { owner: "lift-demo", repo: "express-postgres" };
    const unknown = await call("POST", "/agent/plans", { ...body, commitSha: "b".repeat(40) });
    expect(unknown.statusCode).toBe(400);
    expect(Problem.parse(unknown.json())).toMatchObject({
      code: "validation_failed",
      fields: { commitSha: "No such commit" },
    });
    const branch = await call("POST", "/agent/plans", {
      ...body,
      branch: "nope",
      commitSha: DEV_SHA,
    });
    expect(branch.statusCode).toBe(400);
    expect(Problem.parse(branch.json())).toMatchObject({
      code: "validation_failed",
      fields: { branch: "No such branch" },
    });
    // Only a full SHA: a short or uppercase one never reaches GitHub.
    for (const commitSha of [DEV_SHA.slice(0, 7), DEV_SHA.toUpperCase()]) {
      const malformed = Problem.parse(
        (await call("POST", "/agent/plans", { ...body, commitSha })).json(),
      );
      expect(malformed).toMatchObject({
        status: 400,
        code: "validation_failed",
        fields: { commitSha: "Expected a full 40-character git SHA" },
      });
    }
    expect(agent.calls).toHaveLength(0);
  });

  it("says when the agent is down or slow, and passes on its budget and plan errors", async () => {
    const body = { owner: "lift-demo", repo: "express-postgres" };
    agent.next = () => Promise.reject(new TypeError("fetch failed"));
    const down = Problem.parse((await call("POST", "/agent/plans", body)).json());
    expect(down).toMatchObject({ status: 503, code: "upstream_unavailable" });
    expect(down.detail).toContain("isn't reachable");

    agent.next = () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));
    expect(Problem.parse((await call("POST", "/agent/plans", body)).json()).detail).toContain(
      "more than a minute",
    );

    agent.next = async () => problemResponse(429, "rate_limited", "Today's AI budget is spent.");
    expect(Problem.parse((await call("POST", "/agent/plans", body)).json())).toMatchObject({
      status: 429,
      detail: "Today's AI budget is spent.",
    });

    // The agent refusing the API's token is the server's problem, never a sign-out for the user.
    agent.next = async () => problemResponse(401, "unauthenticated", "Bad token");
    expect(Problem.parse((await call("POST", "/agent/plans", body)).json()).status).toBe(503);
  });
});

describe("GET /agent/plans/:id", () => {
  it("is for the plan's creator only", async () => {
    const plan = await newPlan();
    expect(OnboardingPlan.parse((await call("GET", `/agent/plans/${plan.id}`)).json())).toEqual(
      plan,
    );
    const other = await buildTestApp(
      database,
      {},
      {
        githubFetch: fakeGithub({ login: "kofi-mensah", id: 5151 }).fetch,
        queuePrefix,
      },
    );
    others.push(other);
    const otherSession = await signIn(other);
    const response = await other.inject({
      method: "GET",
      url: `${API_BASE_PATH}/agent/plans/${plan.id}`,
      ...as(otherSession),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("POST /agent/plans/:id/apply", () => {
  it("refuses missing and unknown values before creating anything", async () => {
    const plan = await newPlan();
    const before = (await projectsOfUser()).length;
    const missing = Problem.parse(
      (await apply(plan.id, { databases: ["notes-db"], values: [] })).json(),
    );
    expect(missing).toMatchObject({
      code: "validation_failed",
      fields: { "values.STRIPE_SECRET_KEY": "Required" },
    });
    const wrong = Problem.parse(
      (
        await apply(plan.id, {
          databases: ["notes-db", "cache"],
          values: [
            ...typedStripe,
            { service: "api", key: "SESSION_SECRET", value: "mine" },
            { service: "api", key: "OTHER", value: "x" },
          ],
        })
      ).json(),
    );
    expect(wrong.status).toBe(400);
    const off = Problem.parse(
      (await apply(plan.id, { databases: [], values: typedStripe })).json(),
    );
    expect(off.fields?.["values.DATABASE_URL"]).toBe(
      "Turn the database on, or give DATABASE_URL a value",
    );
    expect((await projectsOfUser()).length).toBe(before);
  });

  it("creates the project, the service, its variables, Postgres and the first deployment", async () => {
    const plan = await newPlan();
    const response = await apply(plan.id, {
      projectName: "Notes",
      service: { port: 3001 },
      databases: ["notes-db"],
      values: typedStripe,
    });
    expect(response.statusCode).toBe(201);
    const { project, serviceId } = ApplyPlanResponse.parse(response.json());
    expect(project.name).toBe("Notes");
    const service = project.services.find((candidate) => candidate.id === serviceId);
    expect(service).toMatchObject({
      name: "api",
      port: 3001,
      startCommand: "node server.js",
      healthcheckPath: "/health",
      builder: "railpack",
      repo: { owner: "lift-demo", name: "express-postgres", branch: "main" },
    });
    expect(service?.latestDeployment?.commitSha).toBe(MAIN_SHA);
    const deployment = await call("GET", `/deployments/${service?.latestDeployment?.id}`);
    expect(deployment.json()).toMatchObject({
      commitSha: MAIN_SHA,
      trigger: "manual",
      status: "queued",
    });

    const variables = await database.db
      .select()
      .from(schema.variables)
      .where(eq(schema.variables.serviceId, serviceId));
    const byKey = Object.fromEntries(
      variables.map((row) => [
        row.key,
        { source: row.source, value: secretBox.decrypt(row.valueEnc) },
      ]),
    );
    expect(Object.keys(byKey).sort()).toEqual(["NODE_ENV", "SESSION_SECRET", "STRIPE_SECRET_KEY"]);
    expect(byKey.NODE_ENV).toEqual({ source: "agent", value: "production" });
    expect(byKey.STRIPE_SECRET_KEY).toEqual({ source: "user", value: TYPED });
    expect(byKey.SESSION_SECRET?.source).toBe("agent");
    expect(byKey.SESSION_SECRET?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const [postgres] = await database.db
      .select()
      .from(schema.databases)
      .where(eq(schema.databases.projectId, project.id));
    expect(postgres).toMatchObject({ type: "postgres", name: "notes-db", status: "provisioning" });
    const ops = await app.queues.ops.getJobs(["waiting", "delayed"]);
    expect(
      ops.some((job) => job.data.op === "provision_db" && job.data.databaseId === postgres?.id),
    ).toBe(true);

    const [row] = await database.db
      .select()
      .from(schema.onboardingPlans)
      .where(eq(schema.onboardingPlans.id, plan.id));
    expect(row).toMatchObject({ status: "applied", projectId: project.id });
    const stored = JSON.stringify(row?.plan);
    expect(stored).not.toContain(TYPED);
    expect(stored).not.toContain(byKey.SESSION_SECRET?.value ?? "-");
    await app.redis.del(REDIS_STREAMS.projectEvents.key(project.id));

    // A plan applies once.
    const again = await apply(plan.id, { databases: [], values: typedStripe });
    expect(Problem.parse(again.json())).toMatchObject({
      status: 409,
      detail: "This plan was already applied.",
    });
  });

  it("deploys the commit a plan was made at, on the branch the service follows", async () => {
    const response = await call("POST", "/agent/plans", {
      owner: "lift-demo",
      repo: "express-postgres",
      commitSha: DEV_SHA,
    });
    const plan = OnboardingPlan.parse(response.json());
    const applied = await apply(plan.id, { databases: ["notes-db"], values: typedStripe });
    expect(applied.statusCode).toBe(201);
    const { project, serviceId } = ApplyPlanResponse.parse(applied.json());
    const service = project.services.find((candidate) => candidate.id === serviceId);
    // A push to main deploys this service; its first deployment is the planned commit.
    expect(service?.repo.branch).toBe("main");
    expect(service?.latestDeployment?.commitSha).toBe(DEV_SHA);
  });

  it("generates a different secret each time", async () => {
    const secrets: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const plan = await newPlan();
      const { serviceId, project } = ApplyPlanResponse.parse(
        (
          await apply(plan.id, {
            databases: [],
            values: [
              ...typedStripe,
              { service: "api", key: "DATABASE_URL", value: "postgres://elsewhere/db" },
            ],
          })
        ).json(),
      );
      const [secret] = await database.db
        .select()
        .from(schema.variables)
        .where(
          and(
            eq(schema.variables.serviceId, serviceId),
            eq(schema.variables.key, "SESSION_SECRET"),
          ),
        );
      secrets.push(secretBox.decrypt(secret?.valueEnc ?? Buffer.alloc(0)));
      await app.redis.del(REDIS_STREAMS.projectEvents.key(project.id));
    }
    expect(secrets[0]).not.toBe(secrets[1]);
  });

  it("adds the service to a project the user edits, and refuses one they can't see", async () => {
    const existing = await call("POST", "/projects", { name: "Existing" });
    const projectId = (existing.json() as { id: string }).id;
    const plan = await newPlan();
    const response = await apply(plan.id, {
      projectId,
      databases: [],
      values: [
        ...typedStripe,
        { service: "api", key: "DATABASE_URL", value: "postgres://elsewhere/db" },
      ],
    });
    expect(response.statusCode).toBe(201);
    expect(ApplyPlanResponse.parse(response.json()).project.id).toBe(projectId);
    await app.redis.del(REDIS_STREAMS.projectEvents.key(projectId));
    const other = await newPlan();
    const hidden = await apply(other.id, {
      projectId: "prj_aaaaaaaaaaaaaaaaaaaaaaaa",
      databases: ["notes-db"],
      values: typedStripe,
    });
    expect(hidden.statusCode).toBe(404);
  });

  it("removes what it made when a step fails, and leaves the plan to apply again", async () => {
    const plan = await newPlan();
    const before = new Set((await projectsOfUser()).map((project) => project.id));
    const add = app.queues.build.add.bind(app.queues.build);
    app.queues.build.add = (() => Promise.reject(new Error("Redis is down"))) as typeof add;
    let failed: Awaited<ReturnType<typeof apply>>;
    try {
      failed = await apply(plan.id, { databases: ["notes-db"], values: typedStripe });
    } finally {
      app.queues.build.add = add;
    }
    expect(failed.statusCode).toBe(503);
    const made = (await projectsOfUser()).filter((project) => !before.has(project.id));
    expect(made).toHaveLength(1);
    expect(made[0]?.deletedAt).not.toBeNull();
    const [row] = await database.db
      .select()
      .from(schema.onboardingPlans)
      .where(eq(schema.onboardingPlans.id, plan.id));
    expect(row?.status).toBe("draft");
    await app.redis.del(REDIS_STREAMS.projectEvents.key(made[0]?.id ?? ""));

    const retried = await apply(plan.id, { databases: ["notes-db"], values: typedStripe });
    expect(retried.statusCode).toBe(201);
    await app.redis.del(
      REDIS_STREAMS.projectEvents.key(ApplyPlanResponse.parse(retried.json()).project.id),
    );
  });
});
