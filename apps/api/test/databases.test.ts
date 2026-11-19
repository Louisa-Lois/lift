import { randomBytes } from "node:crypto";
import { schema } from "@lift/db";
import { createTestDatabase, type TestDatabase } from "@lift/db/testing";
import {
  API_BASE_PATH,
  CreatedApiToken,
  cursorPage,
  Database,
  DatabaseCredentials,
  INTERNAL_BASE_PATH,
  INTERNAL_ROUTES,
  OpsJob,
  Problem,
  ProjectDetail,
  ProvisionContext,
  REDIS_STREAMS,
  Service,
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

let database: TestDatabase;
let app: TestApp;
let session: string;
const projects: string[] = [];
const others: TestApp[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  app = await buildTestApp(
    database,
    { WORKER_TOKEN },
    { githubFetch: fakeGithub().fetch, queuePrefix },
  );
  session = await signIn(app);
}, 60_000);

afterAll(async () => {
  for (const other of others) await other.close();
  if (app) {
    for (const queue of Object.values(app.queues)) await queue.obliterate({ force: true });
    for (const id of projects) await app.redis.del(REDIS_STREAMS.projectEvents.key(id));
    await app.close();
  }
  await database?.drop();
});

function call(
  method: "GET" | "POST" | "PUT" | "DELETE",
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

function worker(method: "GET" | "POST", path: string, payload?: object, token = WORKER_TOKEN) {
  return app.inject({
    method,
    url: `${INTERNAL_BASE_PATH}${path}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload ? { payload } : {}),
  });
}

async function newProject(): Promise<string> {
  const response = await call("POST", "/projects", { name: `Shop ${projects.length + 1}` });
  const id = ProjectDetail.parse(response.json()).id;
  projects.push(id);
  return id;
}

let serviceCount = 0;
async function newService(projectId: string): Promise<Service> {
  serviceCount += 1;
  const response = await call("POST", `/projects/${projectId}/services`, {
    name: `web${serviceCount}`,
    repo: { owner: "lift-demo", name: "next-hello" },
    branch: "main",
  });
  expect(response.statusCode).toBe(201);
  return Service.parse(response.json());
}

async function addPostgres(projectId: string): Promise<Database> {
  const response = await call("POST", `/projects/${projectId}/databases`, {
    type: "postgres",
    name: "main-db",
  });
  expect(response.statusCode).toBe(202);
  return Database.parse(response.json());
}

const ready = (databaseId: string) =>
  worker("POST", INTERNAL_ROUTES.databaseStatus.path(databaseId), {
    status: "ready",
    host: "lift-pg",
    port: 5432,
  });

async function variablesOf(serviceId: string) {
  const response = await call("GET", `/services/${serviceId}/variables?reveal=true`);
  return cursorPage(Variable).parse(response.json()).data;
}

async function eventsOf(projectId: string, type: string) {
  return database.db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.projectId, projectId), eq(schema.events.type, type as never)));
}

describe("a project's Postgres database", () => {
  it("starts provisioning, with its own random password, and queues provision_db", async () => {
    const projectId = await newProject();
    const created = await addPostgres(projectId);
    expect(created).toMatchObject({
      projectId,
      type: "postgres",
      name: "main-db",
      status: "provisioning",
      host: null,
      port: null,
      envVar: "DATABASE_URL",
    });
    const [row] = await database.db
      .select()
      .from(schema.databases)
      .where(eq(schema.databases.id, created.id));
    expect(row?.dbName).toBe(created.id);
    expect(row?.username).toBe(created.id);
    expect(row ? secretBox.decrypt(row.passwordEnc) : "").toMatch(/^[A-Za-z0-9_-]{24}$/);

    const job = await app.queues.ops.getJob(`provision_db-${created.id}`);
    expect(OpsJob.parse(job?.data)).toEqual({
      op: "provision_db",
      databaseId: created.id,
      projectId,
      type: "postgres",
    });
    const [event] = await eventsOf(projectId, "database.status_changed");
    expect(event?.data).toMatchObject({
      id: created.id,
      status: "provisioning",
      previousStatus: null,
    });
  });

  it("is Postgres only, one per project", async () => {
    const projectId = await newProject();
    const redis = await call("POST", `/projects/${projectId}/databases`, { type: "redis" });
    expect(redis.statusCode).toBe(400);
    expect(Object.keys(Problem.parse(redis.json()).fields ?? {})).toEqual(["type"]);
    await addPostgres(projectId);
    const second = await call("POST", `/projects/${projectId}/databases`, { type: "postgres" });
    expect(second.statusCode).toBe(409);
    expect(Problem.parse(second.json()).code).toBe("conflict");
  });

  it("hands its credentials to the worker only, with WORKER_TOKEN", async () => {
    const projectId = await newProject();
    const created = await addPostgres(projectId);
    const path = INTERNAL_ROUTES.provisionContext.path(created.id);
    expect((await worker("GET", path, undefined, "")).statusCode).toBe(401);
    const context = ProvisionContext.parse((await worker("GET", path)).json());
    const [row] = await database.db
      .select()
      .from(schema.databases)
      .where(eq(schema.databases.id, created.id));
    expect(context).toMatchObject({
      databaseId: created.id,
      projectId,
      type: "postgres",
      dbName: created.id,
      username: created.id,
    });
    expect(row && context.password === secretBox.decrypt(row.passwordEnc)).toBe(true);
  });

  it("writes DATABASE_URL into every service once ready, never over a value a user set", async () => {
    const projectId = await newProject();
    const plain = await newService(projectId);
    const custom = await newService(projectId);
    await call("PUT", `/services/${custom.id}/variables`, {
      variables: { DATABASE_URL: "postgres://my-own-db/app" },
    });
    const created = await addPostgres(projectId);
    const reported = await ready(created.id);
    expect(reported.json()).toEqual({ status: "ready" });

    const context = ProvisionContext.parse(
      (await worker("GET", INTERNAL_ROUTES.provisionContext.path(created.id))).json(),
    );
    const expected = `postgres://${created.id}:${context.password}@lift-pg:5432/${created.id}`;
    const written = (await variablesOf(plain.id)).find((v) => v.key === "DATABASE_URL");
    expect(written).toMatchObject({ source: "database", databaseId: created.id });
    expect(written?.value === expected).toBe(true);
    const kept = (await variablesOf(custom.id)).find((v) => v.key === "DATABASE_URL");
    expect(kept).toMatchObject({ source: "user", value: "postgres://my-own-db/app" });

    // The database's writes are the system's; the user's own PUT emitted one too.
    const changed = (await eventsOf(projectId, "variables.changed"))
      .filter((event) => event.actorType === "system")
      .map((event) => event.data);
    expect(changed).toContainEqual({ serviceId: plain.id, keys: ["DATABASE_URL"] });
    expect(changed).not.toContainEqual({ serviceId: custom.id, keys: ["DATABASE_URL"] });
    expect(JSON.stringify(changed)).not.toContain(context.password);

    const detail = ProjectDetail.parse((await call("GET", `/projects/${projectId}`)).json());
    expect(detail.databases).toEqual([
      expect.objectContaining({ id: created.id, status: "ready", host: "lift-pg", port: 5432 }),
    ]);

    // A service added later gets it too, and a repeated report changes nothing.
    const later = await newService(projectId);
    expect((await variablesOf(later.id)).map((v) => [v.key, v.source])).toEqual([
      ["DATABASE_URL", "database"],
    ]);
    const before = (await eventsOf(projectId, "variables.changed")).length;
    expect((await ready(created.id)).statusCode).toBe(200);
    expect((await eventsOf(projectId, "variables.changed")).length).toBe(before);
  });

  it("shows its credentials to editors once it's ready", async () => {
    const projectId = await newProject();
    const created = await addPostgres(projectId);
    const path = `/databases/${created.id}/credentials`;
    expect((await call("GET", path)).statusCode).toBe(409);
    await ready(created.id);
    const credentials = DatabaseCredentials.parse((await call("GET", path)).json());
    expect(credentials).toMatchObject({
      host: "lift-pg",
      port: 5432,
      username: created.id,
      database: created.id,
    });
    expect(credentials.url).toBe(
      `postgres://${created.id}:${credentials.password}@lift-pg:5432/${created.id}`,
    );

    // A viewer can see the database but not its password; neither can a deploy token.
    const other = await buildTestApp(
      database,
      {},
      { githubFetch: fakeGithub({ login: "efua-mensah", id: 7171 }).fetch, queuePrefix },
    );
    others.push(other);
    const viewer = await signIn(other);
    const me = User.parse(
      (await other.inject({ method: "GET", url: `${API_BASE_PATH}/me`, ...as(viewer) })).json(),
    );
    await database.db
      .insert(schema.projectMembers)
      .values({ projectId, userId: me.id, role: "viewer" });
    expect((await call("GET", `/databases/${created.id}`, undefined, as(viewer))).statusCode).toBe(
      200,
    );
    expect((await call("GET", path, undefined, as(viewer))).statusCode).toBe(403);
    const token = CreatedApiToken.parse(
      (await call("POST", "/tokens", { name: "deploy", scopes: ["deploy"] })).json(),
    ).token;
    expect(
      (await call("GET", path, undefined, { headers: { authorization: `Bearer ${token}` } }))
        .statusCode,
    ).toBe(403);
  });

  it("goes away when deleted: its DATABASE_URL leaves every service and deprovision_db is queued", async () => {
    const projectId = await newProject();
    const service = await newService(projectId);
    const created = await addPostgres(projectId);
    await ready(created.id);
    expect((await variablesOf(service.id)).map((v) => v.key)).toEqual(["DATABASE_URL"]);

    const deleted = await call("DELETE", `/databases/${created.id}`);
    expect(deleted.statusCode).toBe(202);
    expect(Database.parse(deleted.json()).status).toBe("deleting");
    expect(await variablesOf(service.id)).toEqual([]);
    expect((await call("GET", `/databases/${created.id}`)).statusCode).toBe(404);
    const list = await call("GET", `/projects/${projectId}/databases`);
    expect(cursorPage(Database).parse(list.json()).data).toEqual([]);
    const job = await app.queues.ops.getJob(`deprovision_db-${created.id}`);
    expect(job?.data).toMatchObject({ op: "deprovision_db", databaseId: created.id });

    // The worker may report a failure afterwards, and nothing else.
    expect((await ready(created.id)).statusCode).toBe(409);
    const failed = await worker("POST", INTERNAL_ROUTES.databaseStatus.path(created.id), {
      status: "failed",
      message: "couldn't drop it",
    });
    expect(failed.json()).toEqual({ status: "deleting" });

    // A new one can take its place.
    await addPostgres(projectId);
  });

  it("can fail to provision, and stays failed", async () => {
    const projectId = await newProject();
    const created = await addPostgres(projectId);
    const failed = await worker("POST", INTERNAL_ROUTES.databaseStatus.path(created.id), {
      status: "failed",
      message: "Postgres said no",
    });
    expect(failed.json()).toEqual({ status: "failed" });
    expect((await ready(created.id)).statusCode).toBe(409);
    const shown = Database.parse((await call("GET", `/databases/${created.id}`)).json());
    expect(shown.status).toBe("failed");
  });

  it("is deprovisioned with its project", async () => {
    const projectId = await newProject();
    const created = await addPostgres(projectId);
    expect((await call("DELETE", `/projects/${projectId}`)).statusCode).toBe(204);
    const job = await app.queues.ops.getJob(`deprovision_db-${created.id}`);
    expect(job?.data).toMatchObject({ op: "deprovision_db", databaseId: created.id, projectId });
  });
});
