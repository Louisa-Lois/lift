import { randomBytes } from "node:crypto";
import { createTestDatabase, type TestDatabase } from "@lift/db/testing";
import {
  AnyProjectEvent,
  API_BASE_PATH,
  cursorPage,
  ProjectDetail,
  ProjectEvent,
  REDIS_STREAMS,
  SESSION_COOKIE,
  Service,
} from "@lift/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers/app";
import { fakeGithub } from "./helpers/github";
import { as, signIn } from "./helpers/session";
import { openStream } from "./helpers/sse";

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const HEARTBEAT_MS = 300;
const queuePrefix = `test-${randomBytes(4).toString("hex")}`;

let database: TestDatabase;
let app: TestApp;
let session: string;
let projectId: string;
let base: string;

beforeAll(async () => {
  database = await createTestDatabase();
  app = await buildTestApp(
    database,
    {},
    { githubFetch: fakeGithub().fetch, queuePrefix, sseHeartbeatMs: HEARTBEAT_MS },
  );
  // Streams need a real socket: inject waits for the response to end.
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  session = await signIn(app);
  const project = await app.inject({
    method: "POST",
    url: `${API_BASE_PATH}/projects`,
    ...as(session),
    payload: { name: "Demo shop" },
  });
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

async function createService(name: string): Promise<Service> {
  const response = await app.inject({
    method: "POST",
    url: `${API_BASE_PATH}/projects/${projectId}/services`,
    ...as(session),
    payload: { name, repo: { owner: "lift-demo", name: "next-hello" }, branch: "main" },
  });
  return Service.parse(response.json());
}

const streamUrl = () => `${base}${API_BASE_PATH}/projects/${projectId}/events/stream`;
const stream = (headers: Record<string, string> = {}) =>
  openStream(streamUrl(), { cookie: `${SESSION_COOKIE}=${session}`, ...headers });

describe("a project's activity", () => {
  it("is listed newest first, every item a contract event", async () => {
    const service = await createService("listed");
    const response = await app.inject({
      method: "GET",
      url: `${API_BASE_PATH}/projects/${projectId}/events`,
      ...as(session),
    });
    const page = cursorPage(AnyProjectEvent).parse(response.json());
    expect(page.data[0]).toMatchObject({ type: "service.created", data: { id: service.id } });
    expect(page.data.every((event) => ProjectEvent.safeParse(event).success)).toBe(true);
  });

  it("streams live, each event under its type and with its stream ID", async () => {
    const live = await stream();
    try {
      expect(live.response.headers.get("content-type")).toMatch(/^text\/event-stream/);
      expect(live.response.headers.get("cache-control")).toBe("no-cache, no-transform");
      expect((await live.next()).comment).toBe("connected");
      const service = await createService("live");
      const frame = await live.nextEvent();
      expect(frame.event).toBe("service.created");
      expect(frame.id).toMatch(/^\d+-\d+$/);
      expect(ProjectEvent.parse(JSON.parse(frame.data ?? ""))).toMatchObject({
        type: "service.created",
        projectId,
        data: { id: service.id },
      });
    } finally {
      live.close();
    }
  });

  it("sends a heartbeat while nothing happens", async () => {
    const live = await stream();
    try {
      expect((await live.next()).comment).toBe("connected");
      expect((await live.next(HEARTBEAT_MS * 5)).comment).toBe("heartbeat");
    } finally {
      live.close();
    }
  });

  it("resumes after Last-Event-ID with only the events it missed", async () => {
    const first = await stream();
    let lastId = "";
    try {
      await first.next();
      await createService("seen");
      lastId = (await first.nextEvent()).id ?? "";
    } finally {
      first.close();
    }
    const missed = await createService("missed");
    const resumed = await stream({ "last-event-id": lastId });
    try {
      const frame = await resumed.nextEvent();
      expect(JSON.parse(frame.data ?? "").data.id).toBe(missed.id);
    } finally {
      resumed.close();
    }
  });

  it("is only for the project's members", async () => {
    const other = await buildTestApp(
      database,
      {},
      { githubFetch: fakeGithub({ login: "yaw-boateng", id: 778 }).fetch, queuePrefix },
    );
    try {
      const stranger = await signIn(other);
      const response = await fetch(streamUrl(), {
        headers: { cookie: `${SESSION_COOKIE}=${stranger}` },
      });
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toMatch(/problem\+json/);
    } finally {
      await other.close();
    }
  });
});
