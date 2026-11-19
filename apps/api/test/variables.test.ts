import { randomBytes } from "node:crypto";
import { schema } from "@lift/db";
import { createTestDatabase, type TestDatabase } from "@lift/db/testing";
import {
  API_BASE_PATH,
  BuildContext,
  CreatedApiToken,
  cursorPage,
  Deployment,
  INTERNAL_BASE_PATH,
  INTERNAL_ROUTES,
  imageTagFor,
  Problem,
  ProjectDetail,
  REDIS_STREAMS,
  RuntimeEnv,
  Service,
  UpsertVariablesResponse,
  User,
  Variable,
} from "@lift/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSecretBox } from "../src/services/crypto";
import { buildTestApp, TEST_ENCRYPTION_KEY } from "./helpers/app";
import { fakeGithub } from "./helpers/github";
import { as, signIn } from "./helpers/session";

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const WORKER_TOKEN = `test-worker-${randomBytes(16).toString("hex")}`;
const queuePrefix = `test-${randomBytes(4).toString("hex")}`;
const secretBox = createSecretBox(TEST_ENCRYPTION_KEY);
const SECRET = "s3cr3t-value-1234";

let database: TestDatabase;
let app: TestApp;
let session: string;
let projectId: string;
const others: TestApp[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  app = await buildTestApp(
    database,
    { WORKER_TOKEN },
    { githubFetch: fakeGithub().fetch, queuePrefix },
  );
  session = await signIn(app);
  const project = await call("POST", "/projects", { name: "Variables shop" });
  projectId = ProjectDetail.parse(project.json()).id;
}, 60_000);

afterAll(async () => {
  for (const other of others) await other.close();
  if (app) {
    for (const queue of Object.values(app.queues)) await queue.obliterate({ force: true });
    await app.redis.del(REDIS_STREAMS.projectEvents.key(projectId));
    await app.close();
  }
  await database?.drop();
});

function call(
  method: "GET" | "POST" | "PUT",
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

function worker(
  method: "GET" | "POST",
  path: string,
  payload?: object,
  headers?: Record<string, string>,
) {
  return app.inject({
    method,
    url: `${INTERNAL_BASE_PATH}${path}`,
    headers: headers ?? { authorization: `Bearer ${WORKER_TOKEN}` },
    ...(payload ? { payload } : {}),
  });
}

let count = 0;
async function newService(): Promise<Service> {
  count += 1;
  const response = await call("POST", `/projects/${projectId}/services`, {
    name: `web${count}`,
    repo: { owner: "lift-demo", name: "next-hello" },
    branch: "main",
  });
  expect(response.statusCode).toBe(201);
  return Service.parse(response.json());
}

const put = (serviceId: string, variables: Record<string, string | null>, credentials?: object) =>
  call("PUT", `/services/${serviceId}/variables`, { variables }, credentials);

async function listed(serviceId: string, reveal = false) {
  const response = await call(
    "GET",
    `/services/${serviceId}/variables${reveal ? "?reveal=true" : ""}`,
  );
  expect(response.statusCode).toBe(200);
  return Object.fromEntries(
    cursorPage(Variable)
      .parse(response.json())
      .data.map((variable) => [variable.key, variable.value]),
  );
}

async function storedRows(serviceId: string) {
  return database.db
    .select()
    .from(schema.variables)
    .where(eq(schema.variables.serviceId, serviceId));
}

/** A second user who is a viewer of the project. */
async function viewerSession(): Promise<string> {
  const other = await buildTestApp(
    database,
    {},
    { githubFetch: fakeGithub({ login: "efua-mensah", id: 6161 }).fetch, queuePrefix },
  );
  others.push(other);
  const cookie = await signIn(other);
  const me = User.parse(
    (await other.inject({ method: "GET", url: `${API_BASE_PATH}/me`, ...as(cookie) })).json(),
  );
  await database.db
    .insert(schema.projectMembers)
    .values({ projectId, userId: me.id, role: "viewer" })
    .onConflictDoNothing();
  return cookie;
}

describe("a service's variables", () => {
  it("are stored encrypted, listed masked, and revealed to editors", async () => {
    const service = await newService();
    const response = await put(service.id, { GREETING: "hello-from-lift", API_SECRET: SECRET });
    expect(response.statusCode).toBe(200);
    const body = UpsertVariablesResponse.parse(response.json());
    expect(body.requiresRedeploy).toBe(true);
    expect(
      body.variables.map((variable) => [variable.key, variable.value, variable.source]),
    ).toEqual([
      ["API_SECRET", "••••1234", "user"],
      ["GREETING", "••••lift", "user"],
    ]);
    expect(response.body).not.toContain(SECRET);

    // No plaintext at rest, and each value decrypts back to what was sent.
    const rows = await storedRows(service.id);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.valueEnc.includes(Buffer.from(SECRET))).toBe(false);
      expect(row.valueEnc.includes(Buffer.from("hello-from-lift"))).toBe(false);
    }
    const secretRow = rows.find((row) => row.key === "API_SECRET");
    expect(secretRow && secretBox.decrypt(secretRow.valueEnc) === SECRET).toBe(true);

    expect(await listed(service.id)).toEqual({ API_SECRET: "••••1234", GREETING: "••••lift" });
    expect(await listed(service.id, true)).toEqual({
      API_SECRET: SECRET,
      GREETING: "hello-from-lift",
    });
  });

  it("refuse PORT and LIFT_ keys, field by field, and store nothing", async () => {
    const service = await newService();
    const response = await put(service.id, { PORT: "1", LIFT_SERVICE_ID: "x", OK_KEY: "fine" });
    expect(response.statusCode).toBe(400);
    const problem = Problem.parse(response.json());
    expect(Object.keys(problem.fields ?? {}).sort()).toEqual([
      "variables.LIFT_SERVICE_ID",
      "variables.PORT",
    ]);
    expect(await storedRows(service.id)).toEqual([]);
  });

  it("are deleted with null, and every change emits variables.changed with keys, never values", async () => {
    const service = await newService();
    await put(service.id, { KEEP: "kept-value", DROP: SECRET });
    expect((await put(service.id, { DROP: null, MISSING: null })).statusCode).toBe(200);
    expect(await listed(service.id, true)).toEqual({ KEEP: "kept-value" });

    const events = await database.db
      .select()
      .from(schema.events)
      .where(
        and(eq(schema.events.projectId, projectId), eq(schema.events.type, "variables.changed")),
      );
    const mine = events.filter(
      (event) => (event.data as { serviceId: string }).serviceId === service.id,
    );
    expect(mine.map((event) => event.data)).toEqual([
      { serviceId: service.id, keys: ["DROP", "KEEP"] },
      // MISSING didn't exist, so only DROP changed.
      { serviceId: service.id, keys: ["DROP"] },
    ]);
    expect(JSON.stringify(mine)).not.toContain(SECRET);
    expect(JSON.stringify(mine)).not.toContain("kept-value");
  });

  it("are masked for a viewer, who can't reveal or change them", async () => {
    const service = await newService();
    await put(service.id, { GREETING: "hello-from-lift" });
    const viewer = await viewerSession();
    const read = await call("GET", `/services/${service.id}/variables`, undefined, as(viewer));
    expect(read.statusCode).toBe(200);
    expect(read.body).not.toContain("hello-from-lift");
    const reveal = await call(
      "GET",
      `/services/${service.id}/variables?reveal=true`,
      undefined,
      as(viewer),
    );
    expect(reveal.statusCode).toBe(403);
    expect((await put(service.id, { GREETING: "changed" }, as(viewer))).statusCode).toBe(403);
  });

  it("need an admin token to reveal or change", async () => {
    const service = await newService();
    await put(service.id, { GREETING: "hello-from-lift" });
    const mint = async (scope: string) =>
      CreatedApiToken.parse(
        (await call("POST", "/tokens", { name: scope, scopes: [scope] })).json(),
      ).token;
    const deploy = { headers: { authorization: `Bearer ${await mint("deploy")}` } };
    const admin = { headers: { authorization: `Bearer ${await mint("admin")}` } };
    expect(
      (await call("GET", `/services/${service.id}/variables`, undefined, deploy)).statusCode,
    ).toBe(200);
    expect(
      (await call("GET", `/services/${service.id}/variables?reveal=true`, undefined, deploy))
        .statusCode,
    ).toBe(403);
    expect((await put(service.id, { GREETING: "x" }, deploy)).statusCode).toBe(403);
    expect(
      (await call("GET", `/services/${service.id}/variables?reveal=true`, undefined, admin))
        .statusCode,
    ).toBe(200);
    expect((await put(service.id, { GREETING: "y" }, admin)).statusCode).toBe(200);
  });
});

describe("the worker", () => {
  it("gets every variable at build time, and in plaintext only with WORKER_TOKEN", async () => {
    const service = await newService();
    await put(service.id, { NEXT_PUBLIC_GREETING: "hi", API_SECRET: SECRET });
    const deployment = Deployment.parse(
      (await call("POST", `/services/${service.id}/deployments`, {})).json(),
    );
    const path = INTERNAL_ROUTES.buildContext.path(deployment.id);
    const context = BuildContext.parse((await worker("GET", path)).json());
    expect(context.buildVariables).toEqual({ API_SECRET: SECRET, NEXT_PUBLIC_GREETING: "hi" });
    expect((await worker("GET", path, undefined, {})).statusCode).toBe(401);
  });

  it("runs the container with today's variables plus the system ones", async () => {
    const service = await newService();
    await put(service.id, { GREETING: "hello-from-lift", API_SECRET: SECRET });
    const deployment = Deployment.parse(
      (await call("POST", `/services/${service.id}/deployments`, {})).json(),
    );
    const report = (body: object) =>
      worker("POST", INTERNAL_ROUTES.deploymentStatus.path(deployment.id), {
        at: new Date().toISOString(),
        ...body,
      });
    await report({ status: "building" });
    await report({ status: "deploying", imageTag: imageTagFor(service.id, deployment.id) });

    const path = INTERNAL_ROUTES.runtimeEnv.path(deployment.id);
    const env = RuntimeEnv.parse((await worker("GET", path)).json());
    expect(env.variables.map((variable) => [variable.key, variable.source])).toEqual([
      ["API_SECRET", "user"],
      ["GREETING", "user"],
      ["LIFT_DEPLOYMENT_ID", "system"],
      ["LIFT_PUBLIC_URL", "system"],
      ["LIFT_SERVICE_ID", "system"],
      ["PORT", "system"],
    ]);
    expect(env.variables.find((variable) => variable.key === "API_SECRET")?.value === SECRET).toBe(
      true,
    );
    expect((await worker("GET", path, undefined, {})).statusCode).toBe(401);

    // A changed value changes the hash, so the worker can tell a container is stale.
    await put(service.id, { GREETING: "changed" });
    const after = RuntimeEnv.parse((await worker("GET", path)).json());
    expect(after.envHash).not.toBe(env.envHash);
  });
});
