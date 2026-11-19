import { createHash, randomBytes } from "node:crypto";
import { schema } from "@lift/db";
import { createTestDatabase, type TestDatabase } from "@lift/db/testing";
import {
  API_BASE_PATH,
  ApiToken,
  CreatedApiToken,
  cursorPage,
  Deployment,
  INTERNAL_BASE_PATH,
  INVITE_ONLY_PROBLEM_TYPE,
  newId,
  PERSONAL_TOKEN_PATTERN,
  Problem,
  ProjectDetail,
  REDIS_STREAMS,
  Service,
  type TokenScope,
  User,
} from "@lift/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers/app";
import { fakeGithub } from "./helpers/github";
import { as, signIn } from "./helpers/session";

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Response = Awaited<ReturnType<TestApp["inject"]>>;

const WORKER_TOKEN = "w".repeat(64);
const queuePrefix = `test-${randomBytes(4).toString("hex")}`;
const logLines: string[] = [];

let database: TestDatabase;
let app: TestApp;
let session: string;
let projectId: string;
let serviceId: string;
const others: TestApp[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  app = await buildTestApp(
    database,
    { WORKER_TOKEN, LOG_LEVEL: "info" },
    {
      githubFetch: fakeGithub().fetch,
      queuePrefix,
      logStream: { write: (line) => void logLines.push(line) },
    },
  );
  session = await signIn(app);
  const project = await app.inject({
    method: "POST",
    url: `${API_BASE_PATH}/projects`,
    ...as(session),
    payload: { name: "Token shop" },
  });
  projectId = ProjectDetail.parse(project.json()).id;
  const service = await app.inject({
    method: "POST",
    url: `${API_BASE_PATH}/projects/${projectId}/services`,
    ...as(session),
    payload: { name: "web", repo: { owner: "lift-demo", name: "next-hello" }, branch: "main" },
  });
  serviceId = Service.parse(service.json()).id;
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

const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

async function createToken(
  scopes: TokenScope[] = ["deploy"],
  name = "laptop",
): Promise<CreatedApiToken> {
  const response = await app.inject({
    method: "POST",
    url: `${API_BASE_PATH}/tokens`,
    ...as(session),
    payload: { name, scopes },
  });
  expect(response.statusCode).toBe(201);
  return CreatedApiToken.parse(response.json());
}

function me(token: string, on: TestApp = app): Promise<Response> {
  return on.inject({ method: "GET", url: `${API_BASE_PATH}/me`, ...bearer(token) });
}

function deploy(credentials: object): Promise<Response> {
  return app.inject({
    method: "POST",
    url: `${API_BASE_PATH}/services/${serviceId}/deployments`,
    ...credentials,
    payload: {},
  });
}

async function storedRow(tokenId: string) {
  const [row] = await database.db
    .select()
    .from(schema.apiTokens)
    .where(eq(schema.apiTokens.id, tokenId));
  return row;
}

describe("personal tokens", () => {
  it("are shown once: the database and the list keep only a hash and a prefix", async () => {
    const created = await createToken();
    expect(created.token).toMatch(PERSONAL_TOKEN_PATTERN);
    expect(created.prefix).toBe(created.token.slice(0, 12));
    expect(created).toMatchObject({ name: "laptop", scopes: ["deploy"], projectId: null });

    const row = await storedRow(created.id);
    expect(row?.tokenHash).toBe(createHash("sha256").update(created.token).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(created.token);

    const list = await app.inject({
      method: "GET",
      url: `${API_BASE_PATH}/tokens`,
      ...as(session),
    });
    expect(list.statusCode).toBe(200);
    const listed = cursorPage(ApiToken).parse(list.json()).data;
    expect(listed.map((token) => token.id)).toContain(created.id);
    expect(list.body).not.toContain(created.token);
    expect(logLines.join("")).not.toContain(created.token);
  });

  it("sign requests on any route, and record when they were last used", async () => {
    const created = await createToken(["read"]);
    expect((await storedRow(created.id))?.lastUsedAt).toBeNull();
    const response = await me(created.token);
    expect(response.statusCode).toBe(200);
    expect(User.parse(response.json()).login).toBe("ama-owusu");
    expect((await storedRow(created.id))?.lastUsedAt).toBeInstanceOf(Date);
    const projects = await app.inject({
      method: "GET",
      url: `${API_BASE_PATH}/projects`,
      ...bearer(created.token),
    });
    expect(projects.statusCode).toBe(200);
    expect(logLines.join("")).not.toContain(created.token);
  });

  it("deploy as `cli`, where a session deploys as `manual`", async () => {
    const created = await createToken(["deploy"]);
    const byToken = await deploy(bearer(created.token));
    expect(byToken.statusCode).toBe(202);
    expect(Deployment.parse(byToken.json()).trigger).toBe("cli");
    const bySession = await deploy(as(session));
    expect(bySession.statusCode).toBe(202);
    expect(Deployment.parse(bySession.json()).trigger).toBe("manual");
  });

  it("are limited by their scope: read < deploy < admin", async () => {
    const read = await createToken(["read"]);
    const refused = await deploy(bearer(read.token));
    expect(refused.statusCode).toBe(403);
    expect(Problem.parse(refused.json())).toMatchObject({
      code: "forbidden",
      detail: "This token's scope is read; this needs deploy.",
    });

    const deployer = await createToken(["deploy"]);
    expect((await deploy(bearer(deployer.token))).statusCode).toBe(202);
    const mint = (token: string) =>
      app.inject({
        method: "POST",
        url: `${API_BASE_PATH}/tokens`,
        ...bearer(token),
        payload: { name: "more", scopes: ["admin"] },
      });
    // A deploy token can't make itself an admin token.
    expect((await mint(deployer.token)).statusCode).toBe(403);

    const admin = await createToken(["admin"]);
    expect((await deploy(bearer(admin.token))).statusCode).toBe(202);
    expect((await mint(admin.token)).statusCode).toBe(201);
  });

  it("stop working the moment they are revoked", async () => {
    const created = await createToken();
    expect((await me(created.token)).statusCode).toBe(200);
    const revoke = () =>
      app.inject({
        method: "DELETE",
        url: `${API_BASE_PATH}/tokens/${created.id}`,
        ...as(session),
      });
    expect((await revoke()).statusCode).toBe(204);
    const refused = await me(created.token);
    expect(refused.statusCode).toBe(401);
    expect(Problem.parse(refused.json()).detail).toBe("This token isn't valid or was revoked.");
    expect((await storedRow(created.id))?.revokedAt).toBeInstanceOf(Date);
    // Revoking again is fine and changes nothing.
    expect((await revoke()).statusCode).toBe(204);
  });

  it("can't be listed or revoked by anyone else", async () => {
    const created = await createToken();
    const other = await buildTestApp(
      database,
      {},
      { githubFetch: fakeGithub({ login: "kwame-asante", id: 5151 }).fetch, queuePrefix },
    );
    others.push(other);
    const otherSession = await signIn(other);
    const list = await other.inject({
      method: "GET",
      url: `${API_BASE_PATH}/tokens`,
      ...as(otherSession),
    });
    expect(cursorPage(ApiToken).parse(list.json()).data).toEqual([]);
    const revoke = await other.inject({
      method: "DELETE",
      url: `${API_BASE_PATH}/tokens/${created.id}`,
      ...as(otherSession),
    });
    expect(revoke.statusCode).toBe(404);
    expect((await me(created.token)).statusCode).toBe(200);
  });

  it("win over a cookie: a bad token never falls back to the session", async () => {
    const fake = `lift_pat_${"x".repeat(32)}`;
    const response = await app.inject({
      method: "GET",
      url: `${API_BASE_PATH}/me`,
      headers: { authorization: `Bearer ${fake}` },
      ...as(session),
    });
    expect(response.statusCode).toBe(401);
  });

  it("stop working while their login is off the invite list, but aren't revoked", async () => {
    const created = await createToken();
    const stricter = await buildTestApp(database, { ALLOWED_GITHUB_LOGINS: "vitalik-hakim" });
    others.push(stricter);
    const response = await me(created.token, stricter);
    expect(response.statusCode).toBe(401);
    expect(Problem.parse(response.json()).type).toBe(INVITE_ONLY_PROBLEM_TYPE);
    expect((await storedRow(created.id))?.revokedAt).toBeNull();
    expect((await me(created.token)).statusCode).toBe(200);
  });

  it("survive `lift logout`: signing out with a token revokes nothing", async () => {
    const created = await createToken();
    const logout = await app.inject({
      method: "POST",
      url: `${API_BASE_PATH}/auth/logout`,
      ...bearer(created.token),
    });
    expect(logout.statusCode).toBe(204);
    expect((await me(created.token)).statusCode).toBe(200);
  });

  it("can't be limited to one project yet", async () => {
    const response = await app.inject({
      method: "POST",
      url: `${API_BASE_PATH}/tokens`,
      ...as(session),
      payload: { name: "ci", scopes: ["deploy"], projectId },
    });
    expect(response.statusCode).toBe(400);
    expect(Object.keys(Problem.parse(response.json()).fields ?? {})).toEqual(["projectId"]);
  });

  it("leave the worker's routes to WORKER_TOKEN", async () => {
    const response = await app.inject({
      method: "GET",
      url: `${INTERNAL_BASE_PATH}/deployments/${newId("dep")}/build-context`,
      headers: { authorization: `Bearer ${WORKER_TOKEN}` },
    });
    // Past the worker's auth: the deployment just doesn't exist.
    expect(response.statusCode).toBe(404);
  });
});
