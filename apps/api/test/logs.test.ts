import { randomBytes } from "node:crypto";
import { schema } from "@lift/db";
import { createTestDatabase, type TestDatabase } from "@lift/db/testing";
import {
  API_BASE_PATH,
  Deployment,
  INTERNAL_BASE_PATH,
  INTERNAL_ROUTES,
  LogEntry,
  LogLine,
  LogSnapshot,
  ProjectDetail,
  REDIS_STREAMS,
  SESSION_COOKIE,
  Service,
} from "@lift/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { failStuckDeployments } from "../src/services/deployments";
import { LOG_RETENTION_SECONDS } from "../src/services/logs";
import { buildTestApp } from "./helpers/app";
import { fakeGithub } from "./helpers/github";
import { as, signIn } from "./helpers/session";
import { openStream } from "./helpers/sse";

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const WORKER_TOKEN = `test-worker-${randomBytes(16).toString("hex")}`;
const HEARTBEAT_MS = 300;
const queuePrefix = `test-${randomBytes(4).toString("hex")}`;
const logKey = REDIS_STREAMS.deploymentLogs.key;

let database: TestDatabase;
let app: TestApp;
let session: string;
let projectId: string;
let base: string;
const deploymentIds: string[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  app = await buildTestApp(
    database,
    { WORKER_TOKEN },
    { githubFetch: fakeGithub().fetch, queuePrefix, sseHeartbeatMs: HEARTBEAT_MS },
  );
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  session = await signIn(app);
  const project = await call("POST", "/projects", { name: "Demo shop" });
  projectId = ProjectDetail.parse(project.json()).id;
}, 60_000);

afterAll(async () => {
  if (app) {
    for (const queue of Object.values(app.queues)) await queue.obliterate({ force: true });
    for (const id of deploymentIds) await app.redis.del(logKey(id));
    await app.redis.del(REDIS_STREAMS.projectEvents.key(projectId));
    await app.close();
  }
  await database?.drop();
});

function call(method: "GET" | "POST", url: string, payload?: object) {
  return app.inject({
    method,
    url: `${API_BASE_PATH}${url}`,
    ...as(session),
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

let serviceCount = 0;
async function newService(): Promise<Service> {
  serviceCount += 1;
  const response = await call("POST", `/projects/${projectId}/services`, {
    name: `web${serviceCount}`,
    repo: { owner: "lift-demo", name: "next-hello" },
    branch: "main",
  });
  return Service.parse(response.json());
}

async function deploy(serviceId?: string): Promise<Deployment> {
  const id = serviceId ?? (await newService()).id;
  const response = await call("POST", `/services/${id}/deployments`, {});
  const deployment = Deployment.parse(response.json());
  deploymentIds.push(deployment.id);
  return deployment;
}

/** What the worker writes: one entry per line, with `ts`, `stream` and `line`. */
async function writeLines(deploymentId: string, lines: [string, string][]): Promise<string[]> {
  const ids: string[] = [];
  for (const [stream, line] of lines) {
    const id = await app.redis.xadd(
      logKey(deploymentId),
      "*",
      "ts",
      new Date().toISOString(),
      "stream",
      stream,
      "line",
      line,
    );
    ids.push(id ?? "");
  }
  return ids;
}

async function snapshot(deploymentId: string, tail?: number) {
  const query = tail ? `?tail=${tail}` : "";
  return LogSnapshot.parse((await call("GET", `/deployments/${deploymentId}/logs${query}`)).json());
}

const stream = (deploymentId: string, headers: Record<string, string> = {}) =>
  openStream(`${base}${API_BASE_PATH}/deployments/${deploymentId}/logs/stream`, {
    cookie: `${SESSION_COOKIE}=${session}`,
    ...headers,
  });

const BUILD: [string, string][] = [
  ["system", "Cloning 3f9c2a1"],
  ["build", "npm ci"],
  ["build", "added 312 packages in 9s"],
];

describe("a deployment's logs", () => {
  it("snapshot: the last lines, oldest first, each with its stream ID", async () => {
    const deployment = await deploy();
    const ids = await writeLines(deployment.id, BUILD);
    expect((await snapshot(deployment.id, 2)).data).toEqual([
      expect.objectContaining({ id: ids[1], stream: "build", line: "npm ci" }),
      expect.objectContaining({ id: ids[2], stream: "build", line: "added 312 packages in 9s" }),
    ]);
    expect((await snapshot(deployment.id)).data.map((entry) => entry.id)).toEqual(ids);
  });

  it("stream: replays from the first line, follows live, then ends with the status", async () => {
    const deployment = await deploy();
    const ids = await writeLines(deployment.id, BUILD.slice(0, 2));
    const live = await stream(deployment.id);
    try {
      expect((await live.next()).comment).toBe("connected");
      for (const id of ids) {
        const frame = await live.nextEvent();
        expect(frame).toMatchObject({ id, event: "log" });
        LogLine.parse(JSON.parse(frame.data ?? ""));
      }
      const [third] = await writeLines(deployment.id, BUILD.slice(2));
      expect(await live.nextEvent()).toMatchObject({ id: third, event: "log" });

      await report(deployment.id, { status: "building" });
      await report(deployment.id, { status: "deploying", imageTag: "lift/x:y" });
      await report(deployment.id, { status: "active", containerId: "c1" });
      const end = await live.nextEvent();
      expect(end.event).toBe("end");
      expect(JSON.parse(end.data ?? "")).toEqual({ status: "active" });
      await expect(live.next(2_000)).rejects.toThrow("the stream ended");
    } finally {
      live.close();
    }
  });

  it("stream: resumes after Last-Event-ID", async () => {
    const deployment = await deploy();
    const ids = await writeLines(deployment.id, BUILD);
    const live = await stream(deployment.id, { "last-event-id": ids[1] ?? "" });
    try {
      expect((await live.nextEvent()).id).toBe(ids[2]);
    } finally {
      live.close();
    }
  });

  it("is kept in build_logs when the deployment ends, and served from there later", async () => {
    const deployment = await deploy();
    const ids = await writeLines(deployment.id, BUILD.slice(0, 2));
    await report(deployment.id, { status: "building" });
    await report(deployment.id, { status: "failed", errorCode: "build_failed" });

    const [stored] = await app.db
      .select()
      .from(schema.buildLogs)
      .where(eq(schema.buildLogs.deploymentId, deployment.id));
    const copy = (stored?.content ?? "")
      .split("\n")
      .map((line) => LogEntry.parse(JSON.parse(line)));
    expect(copy.map((entry) => entry.id)).toEqual(ids);
    const ttl = await app.redis.ttl(logKey(deployment.id));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(LOG_RETENTION_SECONDS);
    // The end marker is never a line.
    expect((await snapshot(deployment.id)).data.map((entry) => entry.id)).toEqual(ids);

    await app.redis.del(logKey(deployment.id));
    expect((await snapshot(deployment.id)).data.map((entry) => entry.id)).toEqual(ids);
    const replay = await stream(deployment.id);
    try {
      expect((await replay.nextEvent()).id).toBe(ids[0]);
      expect((await replay.nextEvent()).id).toBe(ids[1]);
      const end = await replay.nextEvent();
      expect(end.event).toBe("end");
      expect(JSON.parse(end.data ?? "")).toEqual({ status: "failed" });
    } finally {
      replay.close();
    }
  });

  it("stream: ends when a newer deployment cancels this one", async () => {
    const service = await newService();
    const first = await deploy(service.id);
    const live = await stream(first.id);
    try {
      expect((await live.next()).comment).toBe("connected");
      await deploy(service.id);
      const end = await live.nextEvent();
      expect(end.event).toBe("end");
      expect(JSON.parse(end.data ?? "")).toEqual({ status: "canceled" });
    } finally {
      live.close();
    }
  });

  it("stream: ends a finished deployment even if its end marker never arrived", async () => {
    const deployment = await deploy();
    await writeLines(deployment.id, BUILD.slice(0, 1));
    await app.db
      .update(schema.deployments)
      .set({ status: "failed" })
      .where(eq(schema.deployments.id, deployment.id));
    const live = await stream(deployment.id);
    try {
      expect((await live.nextEvent()).event).toBe("log");
      const end = await live.nextEvent(HEARTBEAT_MS * 5);
      expect(end).toMatchObject({ event: "end" });
      expect(JSON.parse(end.data ?? "")).toEqual({ status: "failed" });
    } finally {
      live.close();
    }
  });

  it("gets its end marker from the backstop too", async () => {
    const deployment = await deploy();
    await report(deployment.id, { status: "building" });
    const deps = { db: app.db, redis: app.redis, queues: app.queues, log: app.log };
    expect(await failStuckDeployments(deps, new Date(Date.now() + 21 * 60_000))).toContain(
      deployment.id,
    );
    const [[, fields] = ["", []]] = await app.redis.xrevrange(
      logKey(deployment.id),
      "+",
      "-",
      "COUNT",
      1,
    );
    expect(fields).toEqual(["end", "failed"]);
  });
});
