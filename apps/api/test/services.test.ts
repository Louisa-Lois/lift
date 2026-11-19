import { randomBytes } from "node:crypto";
import { schema } from "@lift/db";
import { createTestDatabase, type TestDatabase } from "@lift/db/testing";
import {
  API_BASE_PATH,
  cursorPage,
  OpsJob,
  Problem,
  ProjectDetail,
  REDIS_STREAMS,
  Service,
} from "@lift/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers/app";
import { fakeGithub } from "./helpers/github";
import { as, signIn } from "./helpers/session";

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

let database: TestDatabase;
let app: TestApp;
let session: string;
let projectId: string;
const queuePrefix = `test-${randomBytes(4).toString("hex")}`;

beforeAll(async () => {
  database = await createTestDatabase();
  app = await buildTestApp(database, {}, { githubFetch: fakeGithub().fetch, queuePrefix });
  session = await signIn(app);
  const project = await call("POST", "/projects", { name: "Demo shop" });
  projectId = ProjectDetail.parse(project.json()).id;
}, 60_000);
afterAll(async () => {
  await app?.queues.ops.obliterate({ force: true });
  await app?.close();
  await database?.drop();
});

function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) {
  return app.inject({
    method,
    url: `${API_BASE_PATH}${url}`,
    ...as(session),
    ...(payload ? { payload } : {}),
  });
}

const NEXT_HELLO = { repo: { owner: "lift-demo", name: "next-hello" }, branch: "main" };

describe("creating a service", () => {
  it("creates it from a repo with the defaults and its generated domain", async () => {
    const response = await call("POST", `/projects/${projectId}/services`, {
      name: "web",
      ...NEXT_HELLO,
    });
    expect(response.statusCode).toBe(201);
    const service = Service.parse(response.json());
    expect(service).toMatchObject({
      name: "web",
      slug: "web",
      subdomain: "web-demo-shop",
      url: "http://web-demo-shop.apps.localhost",
      repo: { owner: "lift-demo", name: "next-hello", branch: "main" },
      rootDir: ".",
      builder: "railpack",
      port: 3000,
      cpu: 0.5,
      memoryMb: 512,
      latestDeployment: null,
      activeDeploymentId: null,
    });
    const domains = await database.db
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.serviceId, service.id));
    expect(domains).toMatchObject([
      { hostname: "web-demo-shop.apps.localhost", kind: "generated", status: "active" },
    ]);
    const stream = await app.redis.xrange(REDIS_STREAMS.projectEvents.key(projectId), "-", "+");
    expect(JSON.parse(stream.at(-1)?.[1][1] ?? "{}")).toMatchObject({
      type: "service.created",
      actorType: "user",
      data: { id: service.id, subdomain: "web-demo-shop" },
    });
  });

  it("gives a second service with the same name a suffixed slug and subdomain", async () => {
    const service = Service.parse(
      (
        await call("POST", `/projects/${projectId}/services`, { name: "web", ...NEXT_HELLO })
      ).json(),
    );
    expect(service.slug).toMatch(/^web-[a-z0-9]{4}$/);
    expect(service.subdomain).toBe(`${service.slug}-demo-shop`);
  });

  it("refuses a repo the user can't read, pointing at the repo field", async () => {
    const response = await call("POST", `/projects/${projectId}/services`, {
      name: "api",
      repo: { owner: "lift-demo", name: "secret" },
      branch: "main",
    });
    expect(response.statusCode).toBe(502);
    expect(Problem.parse(response.json())).toMatchObject({
      code: "github_error",
      fields: { "repo.name": expect.any(String) },
    });
  });

  it("refuses a branch that doesn't exist, pointing at the branch field", async () => {
    const response = await call("POST", `/projects/${projectId}/services`, {
      name: "api",
      ...NEXT_HELLO,
      branch: "nope",
    });
    expect(response.statusCode).toBe(400);
    expect(Problem.parse(response.json()).fields).toHaveProperty("branch");
  });

  it("refuses fields the contract doesn't have", async () => {
    const response = await call("POST", `/projects/${projectId}/services`, {
      name: "api",
      ...NEXT_HELLO,
      cpu: 4,
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("a service", () => {
  let serviceId: string;
  beforeAll(async () => {
    const response = await call("POST", `/projects/${projectId}/services`, {
      name: "worker",
      ...NEXT_HELLO,
    });
    serviceId = Service.parse(response.json()).id;
  });

  it("is listed with its project and readable on its own", async () => {
    const list = cursorPage(Service).parse(
      (await call("GET", `/projects/${projectId}/services`)).json(),
    );
    expect(list.data.map((service) => service.id)).toContain(serviceId);
    expect(Service.parse((await call("GET", `/services/${serviceId}`)).json()).id).toBe(serviceId);
  });

  it("takes settings changes and records service.updated", async () => {
    const response = await call("PATCH", `/services/${serviceId}`, {
      port: 8080,
      startCommand: "node server.js",
    });
    expect(Service.parse(response.json())).toMatchObject({
      port: 8080,
      startCommand: "node server.js",
    });
    const events = await database.db
      .select()
      .from(schema.events)
      .where(
        and(eq(schema.events.projectId, projectId), eq(schema.events.type, "service.updated")),
      );
    expect(events).toHaveLength(1);
  });

  it("refuses an empty change", async () => {
    expect((await call("PATCH", `/services/${serviceId}`, {})).statusCode).toBe(400);
  });

  it("is deleted, and the worker is asked to remove its containers", async () => {
    expect((await call("DELETE", `/services/${serviceId}`)).statusCode).toBe(204);
    expect((await call("GET", `/services/${serviceId}`)).statusCode).toBe(404);
    const jobs = await app.queues.ops.getJobs(["waiting", "prioritized", "delayed"]);
    const removal = jobs.find((job) => job.data.serviceId === serviceId);
    expect(OpsJob.parse(removal?.data)).toEqual({ op: "remove_service", serviceId, projectId });
  });
});

describe("on a real apps domain", () => {
  it("serves the service over https", async () => {
    const httpsApp = await buildTestApp(
      database,
      { APPS_DOMAIN: "apps.example.test" },
      { githubFetch: fakeGithub().fetch, queuePrefix },
    );
    try {
      const signedIn = await signIn(httpsApp);
      const response = await httpsApp.inject({
        method: "POST",
        url: `${API_BASE_PATH}/projects/${projectId}/services`,
        ...as(signedIn),
        payload: { name: "site", ...NEXT_HELLO },
      });
      expect(Service.parse(response.json()).url).toBe("https://site-demo-shop.apps.example.test");
    } finally {
      await httpsApp.close();
    }
  });
});
