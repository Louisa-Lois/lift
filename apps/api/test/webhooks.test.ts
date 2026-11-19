import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { schema } from "@lift/db";
import { createTestDatabase, type TestDatabase } from "@lift/db/testing";
import {
  API_BASE_PATH,
  BuildJob,
  cursorPage,
  Deployment,
  newId,
  Problem,
  ProjectDetail,
  REDIS_STREAMS,
  Service,
} from "@lift/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSecretBox } from "../src/services/crypto";
import { buildTestApp, TEST_ENCRYPTION_KEY } from "./helpers/app";
import { fakeGithub } from "./helpers/github";
import { as, signIn } from "./helpers/session";

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

// GitHub reaches this API only off localhost, so these tests use a public-looking PUBLIC_URL.
const PUBLIC_URL = "https://lift.example.test";
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/github/${name}.json`, import.meta.url), "utf8");
const PUSH = fixture("push");
const PING = fixture("ping");
const MAIN_SHA = "3f9c2a1b7d4e5f60718293a4b5c6d7e8f9012345";
const queuePrefix = `test-${randomBytes(4).toString("hex")}`;
const github = fakeGithub();
const secretBox = createSecretBox(TEST_ENCRYPTION_KEY);

let database: TestDatabase;
let app: TestApp;
let session: string;
let projectId: string;
const others: TestApp[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  app = await buildTestApp(database, { PUBLIC_URL }, { githubFetch: github.fetch, queuePrefix });
  session = await signIn(app);
  const project = await call(app, session, "POST", "/projects", { name: "Demo shop" });
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
  on: TestApp,
  cookie: string,
  method: "GET" | "POST" | "DELETE",
  url: string,
  payload?: object,
) {
  return on.inject({
    method,
    url: `${API_BASE_PATH}${url}`,
    ...as(cookie),
    ...(payload ? { payload } : {}),
  });
}

/** Another API on the same database, with its own GitHub and settings. */
async function otherApp(
  env: Record<string, string>,
  options: Parameters<typeof fakeGithub>[0] = {},
) {
  const other = await buildTestApp(database, env, {
    githubFetch: fakeGithub(options).fetch,
    queuePrefix,
  });
  others.push(other);
  return { app: other, session: await signIn(other) };
}

let count = 0;
async function newService(on = app, cookie = session): Promise<Service> {
  count += 1;
  const response = await call(on, cookie, "POST", `/projects/${projectId}/services`, {
    name: `web${count}`,
    repo: { owner: "lift-demo", name: "next-hello" },
    branch: "main",
  });
  expect(response.statusCode).toBe(201);
  return Service.parse(response.json());
}

/** The hook GitHub was asked to create for a service, as sent. */
function hookRequest(serviceId: string) {
  const sent = github.calls.find(
    (entry) =>
      entry.method === "POST" &&
      entry.url.pathname === "/repos/lift-demo/next-hello/hooks" &&
      entry.body.includes(`service=${serviceId}`),
  );
  return sent && { ...sent, json: JSON.parse(sent.body) as { config: { secret: string } } };
}

async function row(serviceId: string) {
  const [found] = await app.db
    .select()
    .from(schema.services)
    .where(eq(schema.services.id, serviceId));
  return found;
}

const sign = (secret: string, body: string) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

function deliver(serviceId: string, event: string, body: string, signature?: string) {
  return app.inject({
    method: "POST",
    url: `${API_BASE_PATH}/webhooks/github?service=${serviceId}`,
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-github-delivery": randomUUID(),
      ...(signature ? { "x-hub-signature-256": signature } : {}),
    },
    payload: body,
  });
}

async function deploymentsOf(serviceId: string) {
  const response = await call(app, session, "GET", `/services/${serviceId}/deployments`);
  return cursorPage(Deployment).parse(response.json()).data;
}

const pushWith = (changes: Record<string, unknown>) =>
  JSON.stringify({ ...JSON.parse(PUSH), ...changes });

describe("a service's push webhook", () => {
  it("is added when the service is created: push events, JSON, a secret of its own", async () => {
    const service = await newService();
    const sent = hookRequest(service.id);
    expect(sent?.json).toEqual({
      name: "web",
      active: true,
      events: ["push"],
      config: {
        url: `${PUBLIC_URL}${API_BASE_PATH}/webhooks/github?service=${service.id}`,
        content_type: "json",
        insecure_ssl: "0",
        secret: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
    // Asked with the user's own token (compared, never printed).
    expect(sent?.headers.get("authorization") === `Bearer ${github.token}`).toBe(true);
    const stored = await row(service.id);
    expect(stored?.webhookId).toBe(4242);
    const secret = stored?.webhookSecretEnc ? secretBox.decrypt(stored.webhookSecretEnc) : "";
    expect(secret === sent?.json.config.secret).toBe(true);
  });

  it("isn't added while the API runs on localhost, where GitHub can't deliver", async () => {
    const local = await otherApp({});
    const before = github.calls.length;
    const service = await newService(local.app, local.session);
    expect((await row(service.id))?.webhookId).toBeNull();
    expect(github.calls.length).toBe(before);
  });

  it("is skipped, not fatal, when GitHub refuses it (no admin rights on the repo)", async () => {
    const refused = await otherApp({ PUBLIC_URL }, { hookStatus: 403 });
    const service = await newService(refused.app, refused.session);
    expect((await row(service.id))?.webhookId).toBeNull();
  });

  it("is added on the next deploy of a service that has none", async () => {
    const local = await otherApp({});
    const service = await newService(local.app, local.session);
    expect(hookRequest(service.id)).toBeUndefined();
    const deploy = await call(app, session, "POST", `/services/${service.id}/deployments`, {});
    expect(deploy.statusCode).toBe(202);
    expect(hookRequest(service.id)).toBeDefined();
    expect((await row(service.id))?.webhookId).toBe(4242);
  });

  it("is removed with the service", async () => {
    const service = await newService();
    expect((await call(app, session, "DELETE", `/services/${service.id}`)).statusCode).toBe(204);
    expect(
      github.calls.some(
        (entry) =>
          entry.method === "DELETE" &&
          entry.url.pathname === "/repos/lift-demo/next-hello/hooks/4242",
      ),
    ).toBe(true);
  });
});

describe("push deliveries", () => {
  let service: Service;
  let secret: string;

  beforeAll(async () => {
    service = await newService();
    secret = hookRequest(service.id)?.json.config.secret ?? "";
  });

  it("refuse a bad or missing signature, and change nothing", async () => {
    const forged = await deliver(service.id, "push", PUSH, sign("not-the-secret", PUSH));
    expect(forged.statusCode).toBe(401);
    expect(Problem.parse(forged.json()).code).toBe("unauthenticated");
    expect((await deliver(service.id, "push", PUSH)).statusCode).toBe(401);
    // A body changed after signing is refused too.
    const tampered = PUSH.replace("Add the checkout page", "Add a backdoor");
    expect((await deliver(service.id, "push", tampered, sign(secret, PUSH))).statusCode).toBe(401);
    expect(await deploymentsOf(service.id)).toEqual([]);
  });

  it("wait a moment for a secret still being saved, as on GitHub's first ping", async () => {
    const local = await otherApp({});
    const fresh = await newService(local.app, local.session);
    const freshSecret = "f".repeat(64);
    const ping = deliver(fresh.id, "ping", PING, sign(freshSecret, PING));
    await new Promise((resolve) => setTimeout(resolve, 300));
    await app.db
      .update(schema.services)
      .set({ webhookId: 4243, webhookSecretEnc: secretBox.encrypt(freshSecret) })
      .where(eq(schema.services.id, fresh.id));
    expect((await ping).statusCode).toBe(200);
  });

  it("answer GitHub's ping", async () => {
    const ping = await deliver(service.id, "ping", PING, sign(secret, PING));
    expect(ping.statusCode).toBe(200);
    expect(ping.body).toBe("Lift is listening for pushes.");
  });

  it("deploy a push to the service's branch, once per commit", async () => {
    const first = await deliver(service.id, "push", PUSH, sign(secret, PUSH));
    expect(first.statusCode).toBe(202);
    const [deployment] = await deploymentsOf(service.id);
    expect(first.body).toBe(`Queued deployment ${deployment?.id} of 3f9c2a1.`);
    expect(deployment).toMatchObject({
      trigger: "push",
      status: "queued",
      commitSha: MAIN_SHA,
      commitMessage: "Add the checkout page",
      commitAuthor: "ama-owusu",
      createdByUserId: null,
    });
    const job = await app.queues.build.getJob(deployment?.id ?? "");
    expect(BuildJob.parse(job?.data)).toMatchObject({ serviceId: service.id, commitSha: MAIN_SHA });

    // GitHub redelivers, or the same commit arrives again: nothing new.
    const again = await deliver(service.id, "push", PUSH, sign(secret, PUSH));
    expect(again.statusCode).toBe(202);
    expect(again.body).toBe(
      "Ignored: commit 3f9c2a1 was already deployed from a push or the editor.",
    );
    expect(await deploymentsOf(service.id)).toHaveLength(1);
  });

  const DELETED = /^Ignored: the push deleted the branch, or names no commit\.$/;
  const ZERO_SHA = "0".repeat(40);

  it.each([
    ["another branch", "push", { ref: "refs/heads/dev" }, /this service deploys main/],
    // What GitHub sends when the service's branch is deleted.
    [
      "the deletion of the service's branch",
      "push",
      { deleted: true, after: ZERO_SHA, head_commit: null, commits: [] },
      DELETED,
    ],
    // Each signal alone is enough, so neither check can go unnoticed.
    ["a push flagged deleted, even with a commit", "push", { deleted: true }, DELETED],
    ["a push to the zero commit", "push", { deleted: false, after: ZERO_SHA }, DELETED],
    [
      "another repository",
      "push",
      { repository: { full_name: "someone/else" } },
      /someone\/else, not lift-demo\/next-hello/,
    ],
    ["another event", "issues", {}, /Lift deploys on push, not issues/],
  ])("ignore %s", async (_case, event, changes, message) => {
    const other = await newService();
    const otherSecret = hookRequest(other.id)?.json.config.secret ?? "";
    const body = pushWith(changes);
    const response = await deliver(other.id, event, body, sign(otherSecret, body));
    expect(response.statusCode).toBe(202);
    expect(response.body).toMatch(message);
    expect(await deploymentsOf(other.id)).toEqual([]);
    const builds = await app.queues.build.getJobs([
      "waiting",
      "prioritized",
      "delayed",
      "active",
      "completed",
      "failed",
    ]);
    expect(builds.filter((job) => job.data?.serviceId === other.id)).toEqual([]);
  });

  it("answer 404 for a service with no webhook, or none at all", async () => {
    const local = await otherApp({});
    const withoutHook = await newService(local.app, local.session);
    expect((await deliver(withoutHook.id, "push", PUSH, sign(secret, PUSH))).statusCode).toBe(404);
    expect((await deliver(newId("svc"), "push", PUSH, sign(secret, PUSH))).statusCode).toBe(404);
  });
});
