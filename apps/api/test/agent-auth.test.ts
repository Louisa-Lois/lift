import { randomBytes } from "node:crypto";
import { createTestDatabase, type TestDatabase } from "@lift/db/testing";
import {
  API_BASE_PATH,
  CreatedApiToken,
  cursorPage,
  INVITE_ONLY_PROBLEM_TYPE,
  newId,
  Problem,
  ProjectDetail,
  ProjectListItem,
  REDIS_STREAMS,
  Service,
  User,
  Variable,
} from "@lift/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers/app";
import { fakeGithub } from "./helpers/github";
import { as, asAgent, signIn } from "./helpers/session";

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const queuePrefix = `test-${randomBytes(4).toString("hex")}`;
const github = fakeGithub();

let database: TestDatabase;
let app: TestApp;
let session: string;
let userId: string;
let otherUserId: string;
let projectId: string;
let serviceId: string;
const others: TestApp[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  app = await buildTestApp(database, {}, { githubFetch: github.fetch, queuePrefix });
  session = await signIn(app);
  userId = User.parse((await call("GET", "/me")).json()).id;

  // Someone else, who isn't a member of the project below.
  const other = await extraApp({}, fakeGithub({ login: "kofi-mensah", id: 5151 }).fetch);
  const otherSession = await signIn(other);
  const me = await other.inject({ method: "GET", url: `${API_BASE_PATH}/me`, ...as(otherSession) });
  otherUserId = User.parse(me.json()).id;

  projectId = ProjectDetail.parse(
    (await call("POST", "/projects", { name: "Agent reads" })).json(),
  ).id;
  const service = await call("POST", `/projects/${projectId}/services`, {
    name: "web",
    repo: { owner: "lift-demo", name: "next-hello" },
    branch: "main",
    deploy: false,
  });
  serviceId = Service.parse(service.json()).id;
  const put = await call("PUT", `/services/${serviceId}/variables`, {
    variables: { GREETING: "hello-from-lift" },
  });
  expect(put.statusCode).toBe(200);
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

async function extraApp(env: Record<string, string>, githubFetch = github.fetch) {
  const extra = await buildTestApp(database, env, { githubFetch, queuePrefix });
  others.push(extra);
  return extra;
}

function call(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: object,
  credentials: object = as(session),
  on: TestApp = app,
) {
  return on.inject({
    method,
    url: `${API_BASE_PATH}${url}`,
    ...credentials,
    ...(payload ? { payload } : {}),
  });
}

const agent = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: object) =>
  call(method, url, payload, asAgent(userId));

describe("the agent service's credential", () => {
  it("acts as the user it names", async () => {
    const response = await agent("GET", "/me");
    expect(response.statusCode).toBe(200);
    expect(User.parse(response.json()).id).toBe(userId);
  });

  it("reads what that user can read, and nothing more", async () => {
    const projects = cursorPage(ProjectListItem).parse((await agent("GET", "/projects")).json());
    expect(projects.data.map((project) => project.id)).toContain(projectId);
    const variables = cursorPage(Variable).parse(
      (await agent("GET", `/services/${serviceId}/variables`)).json(),
    );
    expect(variables.data.map((variable) => variable.key)).toEqual(["GREETING"]);
    expect(JSON.stringify(variables)).not.toContain("hello-from-lift");

    // Acting as someone who isn't a member, the project doesn't exist.
    const outsider = await call("GET", `/projects/${projectId}`, undefined, asAgent(otherUserId));
    expect(outsider.statusCode).toBe(404);
  });

  it("only reads: every write, revealing, credentials and tokens are refused", async () => {
    const refused = [
      await agent("POST", "/projects", { name: "Made by the agent" }),
      await agent("PATCH", `/services/${serviceId}`, { port: 8080 }),
      await agent("PUT", `/services/${serviceId}/variables`, { variables: { ADMIN: "true" } }),
      await agent("POST", `/services/${serviceId}/deployments`, {}),
      await agent("GET", `/services/${serviceId}/variables?reveal=true`),
      await agent("GET", `/databases/${newId("db")}/credentials`),
      await agent("GET", "/tokens"),
    ];
    for (const response of refused) {
      expect(response.statusCode).toBe(403);
      expect(Problem.parse(response.json()).detail).toBe(
        "The agent service can only read here, and never secrets.",
      );
    }
    const service = Service.parse((await call("GET", `/services/${serviceId}`)).json());
    expect(service.port).not.toBe(8080);
  });

  it("is refused without X-Lift-Act-As, or naming no Lift user", async () => {
    const bare = await call("GET", "/me", undefined, {
      headers: { authorization: asAgent(userId).headers.authorization },
    });
    expect(bare.statusCode).toBe(401);
    expect(Problem.parse(bare.json()).detail).toContain("X-Lift-Act-As");
    for (const actAs of [newId("usr"), "not-a-user-id"]) {
      const response = await call("GET", "/me", undefined, asAgent(actAs));
      expect(response.statusCode, actAs).toBe(401);
    }
  });

  it("is refused when the request came through Traefik, even with the right token", async () => {
    for (const header of ["x-forwarded-for", "x-real-ip", "forwarded"]) {
      const { headers } = asAgent(userId);
      const response = await call("GET", "/me", undefined, {
        headers: { ...headers, [header]: "203.0.113.7" },
      });
      expect(response.statusCode, header).toBe(401);
      expect(Problem.parse(response.json()).detail).toBe("This token isn't valid or was revoked.");
    }
  });

  it("is refused with any other service token", async () => {
    const response = await call(
      "GET",
      "/me",
      undefined,
      asAgent(userId, `lift_svc_${"b".repeat(32)}`),
    );
    expect(response.statusCode).toBe(401);
  });

  it("is the only credential that may send X-Lift-Act-As", async () => {
    const minted = await call("POST", "/tokens", { name: "laptop", scopes: ["admin"] });
    const token = CreatedApiToken.parse(minted.json()).token;
    const actAs = { "x-lift-act-as": otherUserId };
    for (const credentials of [
      { ...as(session), headers: actAs },
      { headers: { ...actAs, authorization: `Bearer ${token}` } },
      { headers: actAs },
    ]) {
      const response = await call("GET", "/me", undefined, credentials);
      expect(response.statusCode).toBe(401);
      expect(Problem.parse(response.json()).detail).toContain("Only the agent service");
    }
  });

  it("stops working for a login taken off the invite list", async () => {
    const stricter = await extraApp({ ALLOWED_GITHUB_LOGINS: "someone-else" });
    const response = await call("GET", "/me", undefined, asAgent(userId), stricter);
    expect(response.statusCode).toBe(401);
    expect(Problem.parse(response.json()).type).toBe(INVITE_ONLY_PROBLEM_TYPE);
  });

  it("works only where AGENT_SERVICE_TOKEN is set", async () => {
    const without = await extraApp({ AGENT_SERVICE_TOKEN: "" });
    const response = await call("GET", "/me", undefined, asAgent(userId), without);
    expect(response.statusCode).toBe(401);
  });
});
