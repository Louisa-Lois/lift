import { randomBytes } from "node:crypto";
import { schema } from "@lift/db";
import { createTestDatabase, type TestDatabase } from "@lift/db/testing";
import {
  API_BASE_PATH,
  cursorPage,
  OpsJob,
  Problem,
  ProjectDetail,
  ProjectListItem,
  REDIS_STREAMS,
} from "@lift/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers/app";
import { fakeGithub } from "./helpers/github";
import { as, signIn } from "./helpers/session";

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

let database: TestDatabase;
let ownerApp: TestApp;
let otherApp: TestApp;
let owner: string;
let other: string;
const queuePrefix = `test-${randomBytes(4).toString("hex")}`;

beforeAll(async () => {
  database = await createTestDatabase();
  ownerApp = await buildTestApp(database, {}, { githubFetch: fakeGithub().fetch, queuePrefix });
  otherApp = await buildTestApp(
    database,
    {},
    { githubFetch: fakeGithub({ login: "other-user", id: 5555 }).fetch, queuePrefix },
  );
  owner = await signIn(ownerApp);
  other = await signIn(otherApp);
}, 60_000);
afterAll(async () => {
  await ownerApp?.queues.ops.obliterate({ force: true });
  await ownerApp?.close();
  await otherApp?.close();
  await database?.drop();
});

const call = (
  app: TestApp,
  session: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: object,
) =>
  app.inject({
    method,
    url: `${API_BASE_PATH}${url}`,
    ...as(session),
    ...(payload ? { payload } : {}),
  });

async function createProject(name: string) {
  const response = await call(ownerApp, owner, "POST", "/projects", { name });
  expect(response.statusCode).toBe(201);
  return ProjectDetail.parse(response.json());
}

async function userId(login: string) {
  const [row] = await database.db.select().from(schema.users).where(eq(schema.users.login, login));
  return row?.id ?? "";
}

describe("projects", () => {
  it("creates a project with you as its owner", async () => {
    const project = await createProject("Demo shop");
    expect(project).toMatchObject({ name: "Demo shop", slug: "demo-shop", role: "owner" });
    expect(project.services).toEqual([]);
    expect(project.databases).toEqual([]);
  });

  it("gives a second project with the same name a suffixed slug", async () => {
    const project = await createProject("Demo shop");
    expect(project.slug).toMatch(/^demo-shop-[a-z0-9]{4}$/);
  });

  it("lists your projects newest first, a page at a time", async () => {
    const first = cursorPage(ProjectListItem).parse(
      (await call(ownerApp, owner, "GET", "/projects?limit=1")).json(),
    );
    expect(first.data[0]?.slug).toMatch(/^demo-shop-/);
    expect(first.nextCursor).toBe("1");
    const second = cursorPage(ProjectListItem).parse(
      (await call(ownerApp, owner, "GET", `/projects?limit=1&cursor=${first.nextCursor}`)).json(),
    );
    expect(second.data[0]).toMatchObject({ slug: "demo-shop", services: [], lastDeployedAt: null });
  });

  it("hides a project from someone who isn't a member", async () => {
    const project = await createProject("Private");
    const response = await call(otherApp, other, "GET", `/projects/${project.id}`);
    expect(response.statusCode).toBe(404);
    expect(Problem.parse(response.json()).code).toBe("not_found");
    const list = cursorPage(ProjectListItem).parse(
      (await call(otherApp, other, "GET", "/projects")).json(),
    );
    expect(list.data).toEqual([]);
  });

  it("lets a viewer read but not rename", async () => {
    const project = await createProject("Shared");
    await database.db
      .insert(schema.projectMembers)
      .values({ projectId: project.id, userId: await userId("other-user"), role: "viewer" });
    const read = await call(otherApp, other, "GET", `/projects/${project.id}`);
    expect(ProjectDetail.parse(read.json()).role).toBe("viewer");
    const rename = await call(otherApp, other, "PATCH", `/projects/${project.id}`, {
      name: "Mine",
    });
    expect(rename.statusCode).toBe(403);
    expect(Problem.parse(rename.json()).code).toBe("forbidden");
  });

  it("renames a project, keeps its slug, and records project.updated", async () => {
    const project = await createProject("Old name");
    const response = await call(ownerApp, owner, "PATCH", `/projects/${project.id}`, {
      name: "New name",
    });
    expect(ProjectDetail.parse(response.json())).toMatchObject({
      name: "New name",
      slug: "old-name",
    });
    const events = await database.db
      .select()
      .from(schema.events)
      .where(
        and(eq(schema.events.projectId, project.id), eq(schema.events.type, "project.updated")),
      );
    expect(events).toHaveLength(1);
    const stream = await ownerApp.redis.xrange(
      REDIS_STREAMS.projectEvents.key(project.id),
      "-",
      "+",
    );
    expect(JSON.parse(stream.at(-1)?.[1][1] ?? "{}")).toMatchObject({
      id: events[0]?.id,
      type: "project.updated",
      data: { name: "New name" },
    });
  });

  it("lets only the owner delete, and queues remove_service for each service", async () => {
    const project = await createProject("Doomed");
    const service = await call(ownerApp, owner, "POST", `/projects/${project.id}/services`, {
      name: "web",
      repo: { owner: "lift-demo", name: "next-hello" },
      branch: "main",
    });
    const serviceId = service.json().id as string;
    await database.db
      .insert(schema.projectMembers)
      .values({ projectId: project.id, userId: await userId("other-user"), role: "editor" });
    expect((await call(otherApp, other, "DELETE", `/projects/${project.id}`)).statusCode).toBe(403);

    expect((await call(ownerApp, owner, "DELETE", `/projects/${project.id}`)).statusCode).toBe(204);
    expect((await call(ownerApp, owner, "GET", `/projects/${project.id}`)).statusCode).toBe(404);
    const jobs = await ownerApp.queues.ops.getJobs(["waiting", "prioritized", "delayed"]);
    const removal = jobs.find((job) => job.data.serviceId === serviceId);
    expect(OpsJob.parse(removal?.data)).toEqual({
      op: "remove_service",
      serviceId,
      projectId: project.id,
    });
  });
});
