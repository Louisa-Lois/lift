import { randomBytes } from "node:crypto";
import { schema } from "@lift/db";
import { createTestDatabase, type TestDatabase } from "@lift/db/testing";
import {
  API_BASE_PATH,
  BuildContext,
  BuildJob,
  cursorPage,
  DeployJob,
  Deployment,
  DeploymentDetail,
  INTERNAL_BASE_PATH,
  INTERNAL_ROUTES,
  imageTagFor,
  newId,
  Problem,
  ProjectDetail,
  REDIS_STREAMS,
  RuntimeEnv,
  Service,
} from "@lift/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { failStuckDeployments } from "../src/services/deployments";
import { buildTestApp } from "./helpers/app";
import { fakeGithub } from "./helpers/github";
import { as, signIn } from "./helpers/session";

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const WORKER_TOKEN = `test-worker-${randomBytes(16).toString("hex")}`;
const MAIN_SHA = "3f9c2a1b7d4e5f60718293a4b5c6d7e8f9012345";
const DEV_SHA = "a".repeat(40);
const github = fakeGithub();
const queuePrefix = `test-${randomBytes(4).toString("hex")}`;

let database: TestDatabase;
let app: TestApp;
let session: string;
let projectId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  app = await buildTestApp(database, { WORKER_TOKEN }, { githubFetch: github.fetch, queuePrefix });
  session = await signIn(app);
  const project = await call("POST", "/projects", { name: "Demo shop" });
  projectId = ProjectDetail.parse(project.json()).id;
}, 60_000);

afterAll(async () => {
  if (app) {
    for (const queue of Object.values(app.queues)) await queue.obliterate({ force: true });
    await app.redis.del(REDIS_STREAMS.projectEvents.key(projectId));
    await app.close();
  }
  await database?.drop();
});

function call(
  method: "GET" | "POST" | "DELETE",
  url: string,
  payload?: object,
  cookie: string = session,
) {
  return app.inject({
    method,
    url: `${API_BASE_PATH}${url}`,
    ...as(cookie),
    ...(payload ? { payload } : {}),
  });
}

const BEARER = { authorization: `Bearer ${WORKER_TOKEN}` };

function worker(method: "GET" | "POST", path: string, payload?: object, headers = BEARER) {
  return app.inject({
    method,
    url: `${INTERNAL_BASE_PATH}${path}`,
    headers,
    ...(payload ? { payload } : {}),
  });
}

const report = (deploymentId: string, body: object) =>
  worker("POST", INTERNAL_ROUTES.deploymentStatus.path(deploymentId), {
    at: new Date().toISOString(),
    ...body,
  });

let serviceCount = 0;
async function newService(body: object = {}): Promise<Service> {
  serviceCount += 1;
  const response = await call("POST", `/projects/${projectId}/services`, {
    name: `web${serviceCount}`,
    repo: { owner: "lift-demo", name: "next-hello" },
    branch: "main",
    ...body,
  });
  expect(response.statusCode).toBe(201);
  return Service.parse(response.json());
}

async function deploy(serviceId: string, body: object = {}): Promise<Deployment> {
  const response = await call("POST", `/services/${serviceId}/deployments`, body);
  expect(response.statusCode).toBe(202);
  return Deployment.parse(response.json());
}

/** What the worker reports for a deployment that goes live. */
async function goLive(service: Service): Promise<Deployment> {
  const deployment = await deploy(service.id);
  await report(deployment.id, { status: "building" });
  await report(deployment.id, {
    status: "deploying",
    imageTag: imageTagFor(service.id, deployment.id),
  });
  await report(deployment.id, { status: "active", containerId: `c-${deployment.id}` });
  return deployment;
}

async function detail(deploymentId: string): Promise<DeploymentDetail> {
  return DeploymentDetail.parse((await call("GET", `/deployments/${deploymentId}`)).json());
}

describe("deploying a service", () => {
  it("queues the branch head as a manual deployment, with its build job", async () => {
    const service = await newService();
    const deployment = await deploy(service.id);
    expect(deployment).toMatchObject({
      serviceId: service.id,
      projectId,
      status: "queued",
      trigger: "manual",
      commitSha: MAIN_SHA,
      commitMessage: "Update the main landing page",
      commitAuthor: "ama-owusu",
    });
    const job = await app.queues.build.getJob(deployment.id);
    expect(job?.name).toBe("build");
    expect(BuildJob.parse(job?.data)).toEqual({
      deploymentId: deployment.id,
      serviceId: service.id,
      projectId,
      repo: { owner: "lift-demo", name: "next-hello", branch: "main" },
      commitSha: MAIN_SHA,
      rootDir: ".",
      builder: "railpack",
    });
    expect((await detail(deployment.id)).timeline.map((step) => step.status)).toEqual(["queued"]);
  });

  it("deploys a given commit, and points at the field for one GitHub doesn't know", async () => {
    const service = await newService();
    expect((await deploy(service.id, { commitSha: DEV_SHA })).commitSha).toBe(DEV_SHA);
    const unknown = await call("POST", `/services/${service.id}/deployments`, {
      commitSha: "b".repeat(40),
    });
    expect(unknown.statusCode).toBe(400);
    expect(Problem.parse(unknown.json()).fields).toEqual({
      commitSha: "No such commit in this repo",
    });
  });

  it("cancels an older queued deployment: newest wins", async () => {
    const service = await newService();
    const first = await deploy(service.id);
    const second = await deploy(service.id);
    expect(await detail(first.id)).toMatchObject({ status: "canceled" });
    expect((await detail(first.id)).timeline.at(-1)?.message).toBe(
      "Replaced by a newer deployment",
    );
    expect(await detail(second.id)).toMatchObject({ status: "queued" });
    expect(await app.queues.build.getJob(first.id)).toBeUndefined();
    // Had the worker taken it already, its next report would stop it.
    const late = await report(first.id, { status: "building" });
    expect(late.statusCode).toBe(409);
    expect(Problem.parse(late.json()).code).toBe("conflict");
  });

  it("starts the first deployment when the service is created with deploy: true", async () => {
    const service = await newService({ deploy: true });
    expect(service.latestDeployment).toMatchObject({ status: "queued", commitSha: MAIN_SHA });
    const job = await app.queues.build.getJob(service.latestDeployment?.id ?? "");
    expect(BuildJob.parse(job?.data).serviceId).toBe(service.id);
  });

  it("lists a service's deployments newest first, a page at a time", async () => {
    const service = await newService();
    const oldest = await deploy(service.id);
    const middle = await deploy(service.id);
    const newest = await deploy(service.id);
    const url = `/services/${service.id}/deployments`;
    const first = cursorPage(Deployment).parse((await call("GET", `${url}?limit=2`)).json());
    expect(first.data.map((deployment) => deployment.id)).toEqual([newest.id, middle.id]);
    const second = cursorPage(Deployment).parse(
      (await call("GET", `${url}?limit=2&cursor=${first.nextCursor}`)).json(),
    );
    expect(second).toEqual({
      data: [expect.objectContaining({ id: oldest.id })],
      nextCursor: null,
    });
  });

  it("lets viewers read but not deploy, and hides it from non-members", async () => {
    const service = await newService();
    const deployment = await deploy(service.id);
    const other = await buildTestApp(
      database,
      { WORKER_TOKEN },
      { githubFetch: fakeGithub({ login: "kofi-mensah", id: 777 }).fetch, queuePrefix },
    );
    try {
      const kofi = await signIn(other);
      expect((await call("GET", `/deployments/${deployment.id}`, undefined, kofi)).statusCode).toBe(
        404,
      );
      expect((await call("POST", `/services/${service.id}/deployments`, {}, kofi)).statusCode).toBe(
        404,
      );

      const [user] = await app.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.login, "kofi-mensah"));
      await app.db
        .insert(schema.projectMembers)
        .values({ projectId, userId: user?.id ?? "", role: "viewer" });
      expect((await call("GET", `/deployments/${deployment.id}`, undefined, kofi)).statusCode).toBe(
        200,
      );
      expect((await call("POST", `/services/${service.id}/deployments`, {}, kofi)).statusCode).toBe(
        403,
      );
    } finally {
      await other.close();
    }
  });
});

describe("the worker's routes", () => {
  it("refuse a missing or wrong token, and anything that came through a proxy", async () => {
    const deployment = await deploy((await newService()).id);
    const path = INTERNAL_ROUTES.buildContext.path(deployment.id);
    expect((await worker("GET", path)).statusCode).toBe(200);
    expect((await worker("GET", path, undefined, {} as typeof BEARER)).statusCode).toBe(401);
    expect(
      (await worker("GET", path, undefined, { authorization: "Bearer nope" })).statusCode,
    ).toBe(401);
    // Traefik adds X-Forwarded-*: through it, the route doesn't exist, even with the token.
    for (const header of ["x-forwarded-for", "x-forwarded-host", "forwarded", "x-real-ip"]) {
      const proxied = await worker("GET", path, undefined, {
        ...BEARER,
        [header]: "203.0.113.9",
      } as typeof BEARER);
      expect(proxied.statusCode).toBe(404);
      expect(Problem.parse(proxied.json()).code).toBe("not_found");
    }
  });

  it("take a deployment from queued to active, queueing the deploy job on the way", async () => {
    const service = await newService();
    const deployment = await deploy(service.id);
    const { buildContext, runtimeEnv } = INTERNAL_ROUTES;

    expect((await report(deployment.id, { status: "building" })).json()).toEqual({
      status: "building",
    });
    // A repeat is accepted and changes nothing.
    expect((await report(deployment.id, { status: "building" })).statusCode).toBe(200);

    const context = BuildContext.parse(
      (await worker("GET", buildContext.path(deployment.id))).json(),
    );
    expect(context).toMatchObject({
      deploymentId: deployment.id,
      serviceId: service.id,
      projectId,
      repo: { owner: "lift-demo", name: "next-hello", branch: "main" },
      commitSha: MAIN_SHA,
      rootDir: ".",
      builder: "railpack",
      buildVariables: {},
    });
    // The project owner's GitHub token, decrypted (compared, never printed).
    expect(context.clone.token === github.token).toBe(true);
    expect(context.clone.expiresAt).toBeNull();
    // No runtime environment until there is something to run.
    expect((await worker("GET", runtimeEnv.path(deployment.id))).statusCode).toBe(409);

    const imageTag = imageTagFor(service.id, deployment.id);
    expect((await report(deployment.id, { status: "deploying", imageTag })).json()).toEqual({
      status: "deploying",
    });
    const job = await app.queues.deploy.getJob(deployment.id);
    expect(job?.name).toBe("deploy");
    expect(DeployJob.parse(job?.data)).toEqual({
      deploymentId: deployment.id,
      serviceId: service.id,
      serviceSlug: service.slug,
      projectId,
      imageTag,
      port: 3000,
      healthcheckPath: "/",
      cpu: 0.5,
      memoryMb: 512,
      hostnames: [new URL(service.url).host],
    });
    // The build is over, so the clone token isn't handed out any more.
    expect((await worker("GET", buildContext.path(deployment.id))).statusCode).toBe(409);

    const env = RuntimeEnv.parse((await worker("GET", runtimeEnv.path(deployment.id))).json());
    expect(
      Object.fromEntries(env.variables.map((variable) => [variable.key, variable.value])),
    ).toEqual({
      PORT: "3000",
      LIFT_SERVICE_ID: service.id,
      LIFT_DEPLOYMENT_ID: deployment.id,
      LIFT_PUBLIC_URL: service.url,
    });
    expect(env.variables.every((variable) => variable.source === "system")).toBe(true);
    const again = RuntimeEnv.parse((await worker("GET", runtimeEnv.path(deployment.id))).json());
    expect(again.envHash).toBe(env.envHash);

    expect(
      (await report(deployment.id, { status: "active", containerId: "c0ffee" })).json(),
    ).toEqual({ status: "active" });
    const done = await detail(deployment.id);
    expect(done.timeline.map((step) => step.status)).toEqual([
      "queued",
      "building",
      "deploying",
      "active",
    ]);
    expect(done).toMatchObject({ imageTag, containerId: "c0ffee" });
    expect(done.startedAt).not.toBeNull();
    expect(done.finishedAt).not.toBeNull();
    const view = Service.parse((await call("GET", `/services/${service.id}`)).json());
    expect(view.activeDeploymentId).toBe(deployment.id);

    // Every step reached the project stream, in order.
    const entries = await app.redis.xrange(REDIS_STREAMS.projectEvents.key(projectId), "-", "+");
    const steps = entries
      .map(([, fields]) => JSON.parse(fields[1] ?? "{}"))
      .filter((event) => event.data?.id === deployment.id)
      .map((event) => (event.type === "deployment.created" ? "created" : event.data.status));
    expect(steps).toEqual(["created", "building", "deploying", "active"]);
  });

  it("supersede the previous active deployment when the next one goes live", async () => {
    const service = await newService();
    const first = await goLive(service);
    const second = await goLive(service);
    const old = await detail(first.id);
    expect(old.status).toBe("superseded");
    expect(old.timeline.at(-1)).toMatchObject({
      status: "superseded",
      message: `Replaced by ${second.id}`,
    });
    expect((await detail(second.id)).status).toBe("active");
  });

  it("record a failure with its code and message, after which nothing moves it", async () => {
    const deployment = await deploy((await newService()).id);
    await report(deployment.id, { status: "building" });
    const failed = await report(deployment.id, {
      status: "failed",
      errorCode: "build_failed",
      message: "npm ci exited with code 1",
    });
    expect(failed.json()).toEqual({ status: "failed" });
    expect(await detail(deployment.id)).toMatchObject({
      status: "failed",
      errorCode: "build_failed",
      errorMessage: "npm ci exited with code 1",
    });
    const late = await report(deployment.id, { status: "deploying", imageTag: "lift/x:y" });
    expect(late.statusCode).toBe(409);
  });

  it("stop a deployment whose service was deleted, but still take its failure", async () => {
    const service = await newService();
    const deployment = await deploy(service.id);
    await report(deployment.id, { status: "building" });
    expect((await call("DELETE", `/services/${service.id}`)).statusCode).toBe(204);
    const deploying = await report(deployment.id, { status: "deploying", imageTag: "lift/x:y" });
    expect(deploying.statusCode).toBe(409);
    const failed = await report(deployment.id, { status: "failed", errorCode: "build_failed" });
    expect(failed.statusCode).toBe(200);
  });

  it("answer 404 for a deployment that doesn't exist", async () => {
    const response = await report(newId("dep"), { status: "building" });
    expect(response.statusCode).toBe(404);
  });
});

describe("the backstop", () => {
  it("fails deployments the worker stopped reporting on: 20 minutes building, 5 deploying", async () => {
    const start = Date.now();
    const building = await deploy((await newService()).id);
    await report(building.id, { status: "building" });
    const deploying = await deploy((await newService()).id);
    await report(deploying.id, { status: "building" });
    await report(deploying.id, { status: "deploying", imageTag: "lift/x:y" });
    const deps = { db: app.db, redis: app.redis, queues: app.queues, log: app.log };

    const afterSix = await failStuckDeployments(deps, new Date(start + 6 * 60_000));
    expect(afterSix).toContain(deploying.id);
    expect(afterSix).not.toContain(building.id);
    const afterTwentyOne = await failStuckDeployments(deps, new Date(start + 21 * 60_000));
    expect(afterTwentyOne).toContain(building.id);

    expect(await detail(building.id)).toMatchObject({
      status: "failed",
      errorCode: "upstream_unavailable",
      errorMessage: "The worker sent no update for 20 minutes while building.",
    });
    expect(await detail(deploying.id)).toMatchObject({
      status: "failed",
      errorMessage: "The worker sent no update for 5 minutes while deploying.",
    });
    // A worker that comes back to it is told to stop.
    const late = await report(building.id, { status: "deploying", imageTag: "lift/x:y" });
    expect(late.statusCode).toBe(409);
  });
});
