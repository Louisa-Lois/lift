import { randomBytes } from "node:crypto";
import { schema } from "@lift/db";
import { createTestDatabase, type TestDatabase } from "@lift/db/testing";
import {
  API_BASE_PATH,
  CreatedApiToken,
  DeployJob,
  Deployment,
  DeploymentDetail,
  INTERNAL_BASE_PATH,
  INTERNAL_ROUTES,
  imageTagFor,
  LogSnapshot,
  Problem,
  ProjectDetail,
  REDIS_STREAMS,
  Service,
  User,
} from "@lift/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers/app";
import { fakeGithub } from "./helpers/github";
import { as, signIn } from "./helpers/session";

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const WORKER_TOKEN = `test-worker-${randomBytes(16).toString("hex")}`;
const queuePrefix = `test-${randomBytes(4).toString("hex")}`;

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
  const project = await call("POST", "/projects", { name: "Rollback shop" });
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
  method: "GET" | "POST" | "PATCH",
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

const report = (deploymentId: string, body: object) =>
  app.inject({
    method: "POST",
    url: `${INTERNAL_BASE_PATH}${INTERNAL_ROUTES.deploymentStatus.path(deploymentId)}`,
    headers: { authorization: `Bearer ${WORKER_TOKEN}` },
    payload: { at: new Date().toISOString(), ...body },
  });

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

async function deploy(service: Service): Promise<Deployment> {
  const response = await call("POST", `/services/${service.id}/deployments`, {});
  expect(response.statusCode).toBe(202);
  return Deployment.parse(response.json());
}

/** A deployment taken all the way to active, as the worker would. */
async function deployActive(service: Service): Promise<Deployment> {
  const deployment = await deploy(service);
  await report(deployment.id, { status: "building" });
  await report(deployment.id, {
    status: "deploying",
    imageTag: imageTagFor(service.id, deployment.id),
  });
  await report(deployment.id, { status: "active", containerId: `c-${deployment.id.slice(-6)}` });
  return deployment;
}

const rollback = (deploymentId: string, credentials?: object) =>
  call("POST", `/deployments/${deploymentId}/rollback`, undefined, credentials);
const cancel = (deploymentId: string, credentials?: object) =>
  call("POST", `/deployments/${deploymentId}/cancel`, undefined, credentials);
const restart = (serviceId: string, credentials?: object) =>
  call("POST", `/services/${serviceId}/restart`, undefined, credentials);

async function statusOf(deploymentId: string) {
  const response = await call("GET", `/deployments/${deploymentId}`);
  return DeploymentDetail.parse(response.json()).status;
}

async function opsJobs(op: string) {
  const jobs = await app.queues.ops.getJobs(["waiting", "prioritized", "delayed", "active"]);
  return jobs.filter((job) => job.name === op).map((job) => job.data);
}

describe("rollback", () => {
  it("runs the old image with today's settings, with no build", async () => {
    const service = await newService();
    const first = await deployActive(service);
    await deployActive(service);
    // Today's settings, changed after the first deployment.
    expect((await call("PATCH", `/services/${service.id}`, { port: 8080 })).statusCode).toBe(200);

    const response = await rollback(first.id);
    expect(response.statusCode).toBe(202);
    const created = Deployment.parse(response.json());
    expect(created).toMatchObject({
      status: "deploying",
      trigger: "rollback",
      rollbackOf: first.id,
      imageTag: imageTagFor(service.id, first.id),
      commitSha: first.commitSha,
    });
    expect(await app.queues.build.getJob(created.id)).toBeUndefined();
    const job = DeployJob.parse((await app.queues.deploy.getJob(created.id))?.data);
    expect(job).toMatchObject({ imageTag: imageTagFor(service.id, first.id), port: 8080 });

    const detail = DeploymentDetail.parse((await call("GET", `/deployments/${created.id}`)).json());
    expect(detail.timeline.map((step) => [step.status, step.message])).toEqual([
      ["deploying", `Rolling back to ${first.commitSha.slice(0, 7)} (${first.id})`],
    ]);
    const log = LogSnapshot.parse((await call("GET", `/deployments/${created.id}/logs`)).json());
    expect(log.data.map((entry) => entry.line)).toContainEqual(
      expect.stringContaining("today's variables and settings"),
    );

    // From here it's an ordinary deploy: active supersedes what was live.
    await report(created.id, { status: "active", containerId: "c-rollback" });
    expect(await statusOf(created.id)).toBe("active");
  });

  it("is refused for a deployment whose image Lift no longer keeps, the live one, or a failed one", async () => {
    const service = await newService();
    const deployments: Deployment[] = [];
    for (let i = 0; i < 5; i++) deployments.push(await deployActive(service));
    const [, second, , fourth, fifth] = deployments;

    const gone = await rollback(second?.id ?? "");
    expect(gone.statusCode).toBe(409);
    expect(Problem.parse(gone.json()).detail).toBe(
      "Lift keeps the images of a service's last 3 builds; this one's is gone.",
    );
    expect(Problem.parse((await rollback(fifth?.id ?? "")).json()).detail).toBe(
      "This deployment is live now.",
    );
    const failed = await deploy(service);
    await report(failed.id, { status: "failed", errorCode: "build_failed" });
    expect((await rollback(failed.id)).statusCode).toBe(409);

    expect((await rollback(fourth?.id ?? "")).statusCode).toBe(202);
  });

  it("cancels a queued deployment: the newest action wins", async () => {
    const service = await newService();
    const first = await deployActive(service);
    await deployActive(service);
    const queued = await deploy(service);
    expect((await rollback(first.id)).statusCode).toBe(202);
    expect(await statusOf(queued.id)).toBe("canceled");
    expect(await app.queues.build.getJob(queued.id)).toBeUndefined();
  });
});

describe("cancel", () => {
  it("drops a queued deployment's build", async () => {
    const service = await newService();
    const queued = await deploy(service);
    const response = await cancel(queued.id);
    expect(response.statusCode).toBe(200);
    expect(Deployment.parse(response.json()).status).toBe("canceled");
    expect(await app.queues.build.getJob(queued.id)).toBeUndefined();
    const detail = DeploymentDetail.parse((await call("GET", `/deployments/${queued.id}`)).json());
    expect(detail.timeline.at(-1)?.message).toBe("Canceled by ama-owusu");
  });

  it("stops a running build, whose late report then gets 409", async () => {
    const service = await newService();
    const building = await deploy(service);
    await report(building.id, { status: "building" });
    expect((await cancel(building.id)).statusCode).toBe(200);
    expect(await opsJobs("stop")).toContainEqual({
      op: "stop",
      deploymentId: building.id,
      serviceId: service.id,
      projectId,
    });
    const late = await report(building.id, {
      status: "deploying",
      imageTag: imageTagFor(service.id, building.id),
    });
    expect(late.statusCode).toBe(409);
  });

  it("is refused once it's deploying", async () => {
    const service = await newService();
    const deploying = await deploy(service);
    await report(deploying.id, { status: "building" });
    await report(deploying.id, {
      status: "deploying",
      imageTag: imageTagFor(service.id, deploying.id),
    });
    const response = await cancel(deploying.id);
    expect(response.statusCode).toBe(409);
    expect(Problem.parse(response.json()).detail).toBe(
      "This deployment is deploying; only a queued or building one can be canceled.",
    );
  });
});

describe("restart", () => {
  it("restarts the active deployment's container, as often as it's asked", async () => {
    const service = await newService();
    const active = await deployActive(service);
    const response = await restart(service.id);
    expect(response.statusCode).toBe(202);
    expect(Service.parse(response.json()).id).toBe(service.id);
    expect((await restart(service.id)).statusCode).toBe(202);
    const jobs = (await opsJobs("restart")).filter((job) => job.serviceId === service.id);
    expect(jobs).toEqual([
      { op: "restart", deploymentId: active.id, serviceId: service.id, projectId },
      { op: "restart", deploymentId: active.id, serviceId: service.id, projectId },
    ]);
    const events = await database.db
      .select()
      .from(schema.events)
      .where(
        and(eq(schema.events.projectId, projectId), eq(schema.events.type, "service.restarted")),
      );
    expect(events.filter((event) => (event.data as { id: string }).id === service.id)).toHaveLength(
      2,
    );
  });

  it("is refused when nothing is running", async () => {
    const service = await newService();
    const response = await restart(service.id);
    expect(response.statusCode).toBe(409);
    expect(Problem.parse(response.json()).detail).toBe(
      `${service.name} has nothing running to restart.`,
    );
  });
});

describe("rollback, cancel and restart", () => {
  it("need the deploy scope and the editor role", async () => {
    const service = await newService();
    const first = await deployActive(service);
    await deployActive(service);
    const queued = await deploy(service);
    const token = async (scope: string) => ({
      headers: {
        authorization: `Bearer ${
          CreatedApiToken.parse(
            (await call("POST", "/tokens", { name: scope, scopes: [scope] })).json(),
          ).token
        }`,
      },
    });
    const read = await token("read");
    expect((await rollback(first.id, read)).statusCode).toBe(403);
    expect((await cancel(queued.id, read)).statusCode).toBe(403);
    expect((await restart(service.id, read)).statusCode).toBe(403);

    const other = await buildTestApp(
      database,
      {},
      { githubFetch: fakeGithub({ login: "efua-mensah", id: 8181 }).fetch, queuePrefix },
    );
    others.push(other);
    const viewer = await signIn(other);
    const me = User.parse(
      (await other.inject({ method: "GET", url: `${API_BASE_PATH}/me`, ...as(viewer) })).json(),
    );
    await database.db
      .insert(schema.projectMembers)
      .values({ projectId, userId: me.id, role: "viewer" });
    expect((await rollback(first.id, as(viewer))).statusCode).toBe(403);
    expect((await cancel(queued.id, as(viewer))).statusCode).toBe(403);
    expect((await restart(service.id, as(viewer))).statusCode).toBe(403);

    const deployer = await token("deploy");
    expect((await restart(service.id, deployer)).statusCode).toBe(202);
    expect((await cancel(queued.id, deployer)).statusCode).toBe(200);
    expect((await rollback(first.id, deployer)).statusCode).toBe(202);
  });
});
