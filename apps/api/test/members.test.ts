import { randomBytes } from "node:crypto";
import { schema } from "@lift/db";
import { createTestDatabase, type TestDatabase } from "@lift/db/testing";
import {
  API_BASE_PATH,
  cursorPage,
  Database,
  Deployment,
  Problem,
  ProjectDetail,
  ProjectListItem,
  ProjectMember,
  type ProjectRole,
  REDIS_STREAMS,
  Service,
  User,
} from "@lift/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server";
import { AUTH_ENV, buildTestApp } from "./helpers/app";
import { testEnv } from "./helpers/env";
import { fakeGithub } from "./helpers/github";
import { as, signIn } from "./helpers/session";

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const queuePrefix = `test-${randomBytes(4).toString("hex")}`;
const RESOURCE_PARAMS = ["projectId", "serviceId", "deploymentId", "databaseId"];

interface Route {
  method: string;
  url: string;
  role: ProjectRole | undefined;
}

let database: TestDatabase;
let app: ReturnType<typeof buildServer>;
let other: TestApp;
const routes: Route[] = [];
let owner: string;
let kofi: string;
let kofiId: string;
let projectId: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  database = await createTestDatabase();
  app = buildServer(testEnv({ DATABASE_URL: database.url, ...AUTH_ENV }), {
    githubFetch: fakeGithub().fetch,
    queuePrefix,
  });
  app.addHook("onRoute", (route) => {
    if (!route.url.startsWith(API_BASE_PATH)) return;
    for (const method of [route.method].flat()) {
      if (method === "HEAD") continue;
      routes.push({ method, url: route.url, role: route.config?.role });
    }
  });
  await app.ready();
  owner = await signIn(app as TestApp);

  // Kofi signs in to Lift once, through an app that answers GitHub as him.
  other = await buildTestApp(
    database,
    {},
    {
      githubFetch: fakeGithub({ login: "kofi-mensah", id: 5151 }).fetch,
      queuePrefix,
    },
  );
  kofi = await signIn(other);
  kofiId = User.parse((await call("GET", "/me", undefined, kofi)).json()).id;

  projectId = ProjectDetail.parse((await call("POST", "/projects", { name: "Members" })).json()).id;
  const service = Service.parse(
    (
      await call("POST", `/projects/${projectId}/services`, {
        name: "web",
        repo: { owner: "lift-demo", name: "next-hello" },
        branch: "main",
      })
    ).json(),
  );
  const deployment = Deployment.parse(
    (await call("POST", `/services/${service.id}/deployments`, {})).json(),
  );
  const postgres = Database.parse(
    (await call("POST", `/projects/${projectId}/databases`, { type: "postgres" })).json(),
  );
  Object.assign(ids, {
    projectId,
    serviceId: service.id,
    deploymentId: deployment.id,
    databaseId: postgres.id,
    userId: kofiId,
  });
}, 60_000);

afterAll(async () => {
  await other?.close();
  if (app) {
    for (const queue of Object.values(app.queues)) await queue.obliterate({ force: true });
    await app.redis.del(REDIS_STREAMS.projectEvents.key(projectId));
    await app.close();
  }
  await database?.drop();
});

function call(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: object,
  session: string = owner,
) {
  return app.inject({
    method,
    url: `${API_BASE_PATH}${url}`,
    ...as(session),
    ...(payload ? { payload } : {}),
  });
}

const members = async (session = owner) =>
  cursorPage(ProjectMember).parse(
    (await call("GET", `/projects/${projectId}/members`, undefined, session)).json(),
  ).data;

async function lastMemberEvent() {
  const [event] = await database.db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.projectId, projectId), eq(schema.events.type, "member.changed")))
    .orderBy(schema.events.createdAt)
    .limit(100)
    .then((rows) => rows.slice(-1));
  return event;
}

describe("a project's members", () => {
  it("start with the owner", async () => {
    const list = await members();
    expect(list.map((member) => [member.user.login, member.role])).toEqual([
      ["ama-owusu", "owner"],
    ]);
  });

  it("are added by GitHub login, by the owner, once they've signed in to Lift", async () => {
    const unknown = await call("POST", `/projects/${projectId}/members`, {
      login: "nobody-here",
      role: "editor",
    });
    expect(Problem.parse(unknown.json())).toMatchObject({
      status: 404,
      fields: { login: "Hasn't signed in to Lift yet" },
    });
    expect(
      (
        await call("POST", `/projects/${projectId}/members`, {
          login: "kofi-mensah",
          role: "owner",
        })
      ).statusCode,
    ).toBe(400);

    const added = await call("POST", `/projects/${projectId}/members`, {
      login: "KOFI-MENSAH",
      role: "viewer",
    });
    expect(added.statusCode).toBe(201);
    expect(ProjectMember.parse(added.json())).toMatchObject({ userId: kofiId, role: "viewer" });
    expect(
      (
        await call("POST", `/projects/${projectId}/members`, {
          login: "kofi-mensah",
          role: "editor",
        })
      ).statusCode,
    ).toBe(409);
    expect(await lastMemberEvent()).toMatchObject({
      actorId: expect.any(String),
      data: expect.objectContaining({ previousRole: null, removed: false }),
    });

    // Kofi now sees the project and its members, and can't change them.
    const projects = cursorPage(ProjectListItem).parse(
      (await call("GET", "/projects", undefined, kofi)).json(),
    );
    expect(projects.data.map((project) => project.id)).toContain(projectId);
    expect((await members(kofi)).map((member) => member.role)).toEqual(["owner", "viewer"]);
    expect(
      (
        await call(
          "POST",
          `/projects/${projectId}/members`,
          { login: "kofi-mensah", role: "editor" },
          kofi,
        )
      ).statusCode,
    ).toBe(403);
  });

  it("are refused every write as viewers, whatever they send (BE-15)", async () => {
    const writes = routes.filter(
      (route) =>
        route.method !== "GET" &&
        RESOURCE_PARAMS.some((param) => route.url.includes(`:${param}`)) &&
        route.role !== "viewer",
    );
    expect(writes.length).toBeGreaterThanOrEqual(15);
    for (const route of writes) {
      const url = route.url
        .replace(API_BASE_PATH, "")
        .replace(/:(\w+)/g, (_, name: string) => ids[name] ?? name);
      const response = await app.inject({
        method: route.method as "POST",
        url: `${API_BASE_PATH}${url}`,
        ...as(kofi),
      });
      expect(response.statusCode, `${route.method} ${route.url}`).toBe(403);
    }
  });

  it("change roles between editor and viewer, and the owner keeps theirs", async () => {
    const changed = await call("PATCH", `/projects/${projectId}/members/${kofiId}`, {
      role: "editor",
    });
    expect(ProjectMember.parse(changed.json()).role).toBe("editor");
    expect((await lastMemberEvent())?.data).toMatchObject({
      role: "editor",
      previousRole: "viewer",
    });
    // As an editor, Kofi can now rename the project, but still not manage members.
    expect(
      (await call("PATCH", `/projects/${projectId}`, { name: "Members too" }, kofi)).statusCode,
    ).toBe(200);
    expect(
      (await call("DELETE", `/projects/${projectId}/members/${kofiId}`, undefined, kofi))
        .statusCode,
    ).toBe(403);
    const ownerId = (await members()).find((member) => member.role === "owner")?.userId ?? "";
    const demote = await call("PATCH", `/projects/${projectId}/members/${ownerId}`, {
      role: "viewer",
    });
    expect(Problem.parse(demote.json())).toMatchObject({ status: 409 });
  });

  it("are removed by the owner, and lose access at once; the owner can't be removed", async () => {
    const ownerId = (await members()).find((member) => member.role === "owner")?.userId ?? "";
    expect((await call("DELETE", `/projects/${projectId}/members/${ownerId}`)).statusCode).toBe(
      409,
    );
    expect((await call("DELETE", `/projects/${projectId}/members/${kofiId}`)).statusCode).toBe(204);
    expect((await lastMemberEvent())?.data).toMatchObject({ userId: kofiId, removed: true });
    expect((await call("GET", `/projects/${projectId}`, undefined, kofi)).statusCode).toBe(404);
    expect((await call("DELETE", `/projects/${projectId}/members/${kofiId}`)).statusCode).toBe(404);
  });
});
