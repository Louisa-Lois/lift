import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { schema } from "@lift/db";
import { createTestDatabase, type TestDatabase } from "@lift/db/testing";
import {
  API_BASE_PATH,
  cursorPage,
  Deployment,
  EditorChange,
  EditorCommit,
  EditorCommitResponse,
  EditorDiscardResponse,
  editorDocumentName,
  Problem,
  ProjectDetail,
  REDIS_STREAMS,
  Service,
  User,
} from "@lift/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSecretBox } from "../src/services/crypto";
import { buildTestApp, TEST_ENCRYPTION_KEY } from "./helpers/app";
import { fakeCollab, savedText, TEST_COLLAB_SECRET } from "./helpers/collab";
import { fakeGitRepo } from "./helpers/git-repo";
import { fakeGithub, gitBlobSha } from "./helpers/github";
import { as, signIn } from "./helpers/session";

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const queuePrefix = `test-${randomBytes(4).toString("hex")}`;
// GitHub reaches the API only off localhost, so services get their push webhook here.
const PUBLIC_URL = "https://lift.example.test";
const OWNER_TOKEN = "gho_owner".padEnd(40, "o");
const KOFI_TOKEN = "gho_kofi".padEnd(40, "k");
const SERVER = "app.listen(3000);\n";
const START = "#!/bin/sh\nnode server.js\n";

/** A fresh repo for each test: three files, the start script executable. */
const newRepo = () =>
  fakeGitRepo({
    owner: "lift-demo",
    name: "next-hello",
    branch: "main",
    files: { "server.js": SERVER, "bin/start.sh": START, "README.md": "# next-hello\n" },
    modes: { "bin/start.sh": "100755" },
  });
let repo = newRepo();
const github = fakeGithub({ accessToken: OWNER_TOKEN });
/** The repo's history and Git data from `repo`, everything else from the recorded fake. */
const githubFetch: typeof globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  return (await repo.handle(request.clone())) ?? github.fetch(request);
};
const secretBox = createSecretBox(TEST_ENCRYPTION_KEY);

let database: TestDatabase;
let collab: ReturnType<typeof fakeCollab>;
let app: TestApp;
let other: TestApp;
let owner: string;
let kofi: string;
let kofiId: string;
let projectId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  collab = fakeCollab(database.db);
  app = await buildTestApp(
    database,
    { COLLAB_SECRET: TEST_COLLAB_SECRET, PUBLIC_URL },
    { githubFetch, collabFetch: collab.fetch, queuePrefix },
  );
  owner = await signIn(app);
  other = await buildTestApp(
    database,
    {},
    {
      githubFetch: fakeGithub({ login: "kofi-mensah", id: 5151, accessToken: KOFI_TOKEN }).fetch,
      queuePrefix,
    },
  );
  kofi = await signIn(other);
  kofiId = User.parse((await call("GET", "/me", undefined, kofi)).json()).id;
  projectId = ProjectDetail.parse((await call("POST", "/projects", { name: "Commits" })).json()).id;
  await call("POST", `/projects/${projectId}/members`, { login: "kofi-mensah", role: "editor" });
}, 60_000);

beforeEach(() => {
  repo = newRepo();
  collab.drafts.clear();
});

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
  method: "GET" | "POST" | "PATCH",
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

let services = 0;
async function newService() {
  services += 1;
  const response = await call("POST", `/projects/${projectId}/services`, {
    name: `web-${services}`,
    repo: { owner: "lift-demo", name: "next-hello" },
    branch: "main",
  });
  return Service.parse(response.json()).id;
}

/** Kofi opens each file, then his drafts are what collab holds. */
async function drafts(serviceId: string, texts: Record<string, string>) {
  for (const [path, text] of Object.entries(texts)) {
    expect(
      (await call("POST", `/services/${serviceId}/editor/session`, { path }, kofi)).statusCode,
    ).toBe(200);
    collab.drafts.set(editorDocumentName(serviceId, path), text);
  }
}

const commit = (serviceId: string, body: object, session = kofi) =>
  call("POST", `/services/${serviceId}/editor/commit`, body, session);

async function changes(serviceId: string) {
  const response = await call("GET", `/services/${serviceId}/editor/changes`, undefined, kofi);
  return cursorPage(EditorChange).parse(response.json()).data;
}

async function deploymentsOf(serviceId: string) {
  const response = await call("GET", `/services/${serviceId}/deployments`);
  return cursorPage(Deployment).parse(response.json()).data;
}

/** The push GitHub delivers once the branch moves, signed with the service's own secret. */
async function deliverPush(serviceId: string, sha: string) {
  const [service] = await database.db
    .select()
    .from(schema.services)
    .where(eq(schema.services.id, serviceId));
  const secret = service?.webhookSecretEnc ? secretBox.decrypt(service.webhookSecretEnc) : "";
  const body = JSON.stringify({
    ref: "refs/heads/main",
    after: sha,
    repository: { full_name: "lift-demo/next-hello" },
    head_commit: { message: "Listen on 8080", author: { username: "kofi-mensah" } },
  });
  return app.inject({
    method: "POST",
    url: `${API_BASE_PATH}/webhooks/github?service=${serviceId}`,
    headers: {
      "content-type": "application/json",
      "x-github-event": "push",
      "x-github-delivery": randomUUID(),
      "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
    },
    payload: body,
  });
}

describe("Commit & deploy", () => {
  it("commits the drafts as the committer, keeping file modes, and deploys the commit once", async () => {
    const serviceId = await newService();
    await drafts(serviceId, {
      "server.js": "app.listen(8080);\n",
      "bin/start.sh": "#!/bin/sh\nexec node server.js\n",
    });
    expect((await changes(serviceId)).map((change) => [change.path, change.baseSha])).toEqual([
      ["bin/start.sh", gitBlobSha(START)],
      ["server.js", gitBlobSha(SERVER)],
    ]);

    let atFastForward: unknown[] = [];
    repo.state.beforeFastForward = async (sha) => {
      atFastForward = await database.db
        .select()
        .from(schema.deployments)
        .where(eq(schema.deployments.commitSha, sha));
    };
    const parent = repo.head();
    const response = await commit(serviceId, { message: "Listen on 8080\n\nAnd exec the server." });
    expect(response.statusCode).toBe(200);
    const { commitSha, deploymentId } = EditorCommitResponse.parse(response.json());

    // One commit on the branch, on its head, with both files; the script stays executable.
    expect(repo.head()).toBe(commitSha);
    expect(repo.commitOf(commitSha)).toMatchObject({
      parents: [parent],
      message: "Listen on 8080\n\nAnd exec the server.",
    });
    expect(repo.fileAt("server.js")?.text).toBe("app.listen(8080);\n");
    expect(repo.fileAt("bin/start.sh")).toMatchObject({
      text: "#!/bin/sh\nexec node server.js\n",
      mode: "100755",
    });
    // Written with Kofi's token, so the commit is his; read with the owner's.
    const writes = repo.calls.filter((entry) => entry.method !== "GET");
    expect(writes.map((entry) => `${entry.method} ${entry.path}`)).toEqual([
      "POST git/blobs",
      "POST git/blobs",
      "POST git/trees",
      "POST git/commits",
      "PATCH git/refs/heads/main",
    ]);
    expect(writes.every((entry) => entry.authorization === `Bearer ${KOFI_TOKEN}`)).toBe(true);
    expect(writes.at(-1)?.body).toEqual({ sha: commitSha, force: false });
    const reads = repo.calls.filter((entry) => entry.method === "GET");
    expect(reads.every((entry) => entry.authorization === `Bearer ${OWNER_TOKEN}`)).toBe(true);

    // The editor deployment existed before the branch moved, and the build is queued.
    expect(atFastForward).toMatchObject([
      { id: deploymentId, trigger: "editor", status: "queued" },
    ]);
    expect(
      Deployment.parse((await call("GET", `/deployments/${deploymentId}`)).json()),
    ).toMatchObject({
      trigger: "editor",
      commitSha,
      commitMessage: "Listen on 8080",
      commitAuthor: "kofi-mensah",
    });
    expect(await app.queues.build.getJob(deploymentId)).toBeDefined();

    // The push GitHub delivers next deploys nothing more.
    const push = await deliverPush(serviceId, commitSha);
    expect(push.statusCode).toBe(202);
    expect(push.body).toBe(
      `Ignored: commit ${commitSha.slice(0, 7)} was already deployed from a push or the editor.`,
    );
    expect((await deploymentsOf(serviceId)).map((deployment) => deployment.id)).toEqual([
      deploymentId,
    ]);

    // Nothing is left to commit; the commit is recorded and announced.
    expect(await changes(serviceId)).toEqual([]);
    const [record] = await database.db
      .select()
      .from(schema.editorCommits)
      .where(eq(schema.editorCommits.serviceId, serviceId));
    expect(record).toMatchObject({
      commitSha,
      paths: ["bin/start.sh", "server.js"],
      authorUserId: kofiId,
      deploymentId,
    });
    const [event] = await database.db
      .select()
      .from(schema.events)
      .where(
        and(eq(schema.events.projectId, projectId), eq(schema.events.type, "editor.committed")),
      );
    expect(EditorCommit.parse(event?.data)).toMatchObject({ serviceId, commitSha, deploymentId });
    expect(event).toMatchObject({ actorType: "user", actorId: kofiId });
  });

  it("commits only the files asked for", async () => {
    const serviceId = await newService();
    await drafts(serviceId, { "server.js": "app.listen(8080);\n", "README.md": "# Mine\n" });
    const response = await commit(serviceId, { message: "Port", paths: ["server.js"] });
    expect(response.statusCode).toBe(200);
    expect(repo.fileAt("server.js")?.text).toBe("app.listen(8080);\n");
    expect(repo.fileAt("README.md")?.text).toBe("# next-hello\n");
    expect((await changes(serviceId)).map((change) => change.path)).toEqual(["README.md"]);
  });

  it("answers 409 naming each file that changed on GitHub, and Discard and reload brings GitHub's", async () => {
    const serviceId = await newService();
    await drafts(serviceId, {
      "server.js": "app.listen(8080);\n",
      "bin/start.sh": "#!/bin/sh\nexec node server.js\n",
      "README.md": "# Mine\n",
    });
    repo.push({ "server.js": "app.listen(4000);\n", "bin/start.sh": null });
    const head = repo.head();
    const response = await commit(serviceId, { message: "Mine" });
    expect(Problem.parse(response.json())).toMatchObject({
      status: 409,
      code: "conflict",
      fields: {
        "server.js": "Changed on GitHub since you opened it",
        "bin/start.sh": "Deleted on GitHub since you opened it",
      },
    });
    // Nothing was written, deployed or moved.
    expect(repo.head()).toBe(head);
    expect(repo.calls.some((entry) => entry.method !== "GET")).toBe(false);
    expect(await deploymentsOf(serviceId)).toEqual([]);

    // "Discard and reload", as the dialog sends it.
    const discard = await call(
      "POST",
      `/services/${serviceId}/editor/discard`,
      { paths: ["server.js", "bin/start.sh"] },
      kofi,
    );
    expect(EditorDiscardResponse.parse(discard.json())).toEqual({
      paths: ["bin/start.sh", "server.js"],
    });
    const name = editorDocumentName(serviceId, "server.js");
    expect(await savedText(database.db, name)).toBe("app.listen(4000);\n");
    // The deleted file's document is gone; README's draft stays, and now commits.
    expect(await savedText(database.db, editorDocumentName(serviceId, "bin/start.sh"))).toBeNull();
    expect((await changes(serviceId)).map((change) => change.path)).toEqual(["README.md"]);
    expect((await commit(serviceId, { message: "Mine" })).statusCode).toBe(200);
    expect(repo.fileAt("README.md")?.text).toBe("# Mine\n");
    expect(repo.fileAt("server.js")?.text).toBe("app.listen(4000);\n");
  });

  it("cancels the deployment when someone pushes during the commit, and keeps the drafts", async () => {
    const serviceId = await newService();
    await drafts(serviceId, { "server.js": "app.listen(8080);\n" });
    repo.state.beforeFastForward = () => {
      repo.state.beforeFastForward = null;
      repo.push({ "README.md": "# Pushed meanwhile\n" });
    };
    const response = await commit(serviceId, { message: "Port" });
    expect(Problem.parse(response.json())).toMatchObject({
      status: 409,
      detail:
        "Someone pushed to main while you were committing, so nothing was committed. Commit again.",
    });
    const [canceled] = await deploymentsOf(serviceId);
    expect(canceled).toMatchObject({ trigger: "editor", status: "canceled" });
    expect(await app.queues.build.getJob(canceled?.id ?? "")).toBeUndefined();
    expect((await changes(serviceId)).map((change) => change.path)).toEqual(["server.js"]);

    // Committing again lands on top of the push.
    const retry = await commit(serviceId, { message: "Port" });
    expect(retry.statusCode).toBe(200);
    expect(repo.fileAt("README.md")?.text).toBe("# Pushed meanwhile\n");
    expect(repo.fileAt("server.js")?.text).toBe("app.listen(8080);\n");
  });

  it("answers 502 when GitHub won't move a protected branch, and cancels the deployment", async () => {
    const serviceId = await newService();
    await drafts(serviceId, { "server.js": "app.listen(8080);\n" });
    repo.state.protected = true;
    const head = repo.head();
    const response = await commit(serviceId, { message: "Port" });
    expect(Problem.parse(response.json())).toMatchObject({ status: 502, code: "github_error" });
    expect(repo.head()).toBe(head);
    expect(await deploymentsOf(serviceId)).toMatchObject([{ status: "canceled" }]);
  });

  it("refuses an empty commit, unknown files, viewers, and people who can't push", async () => {
    const serviceId = await newService();
    expect(Problem.parse((await commit(serviceId, { message: "Nothing" })).json())).toMatchObject({
      status: 400,
      detail: "Nothing to commit: every file matches the last commit.",
    });
    await drafts(serviceId, { "server.js": "app.listen(8080);\n" });
    expect(
      Problem.parse((await commit(serviceId, { message: "x", paths: ["README.md"] })).json()),
    ).toMatchObject({ status: 400, fields: { paths: "Pick files that have changes" } });

    await call("PATCH", `/projects/${projectId}/members/${kofiId}`, { role: "viewer" });
    try {
      expect((await commit(serviceId, { message: "Port" })).statusCode).toBe(403);
      const discard = await call("POST", `/services/${serviceId}/editor/discard`, {}, kofi);
      expect(discard.statusCode).toBe(403);
    } finally {
      await call("PATCH", `/projects/${projectId}/members/${kofiId}`, { role: "editor" });
    }

    repo.state.readOnly.add(KOFI_TOKEN);
    const refused = await commit(serviceId, { message: "Port" });
    expect(Problem.parse(refused.json())).toMatchObject({
      status: 403,
      detail:
        "Your GitHub account can't push to lift-demo/next-hello. Ask for write access, or let someone who has it commit.",
    });
    expect(await deploymentsOf(serviceId)).toEqual([]);
    expect((await changes(serviceId)).map((change) => change.path)).toEqual(["server.js"]);
  });

  it("tells a member whose token it is when GitHub refuses the owner's, and changes nothing", async () => {
    const serviceId = await newService();
    await drafts(serviceId, { "server.js": "app.listen(4000);\n" });
    repo.state.refused.add(OWNER_TOKEN);
    const collabCalls = collab.calls.length;

    for (const response of [
      await commit(serviceId, { message: "Use port 4000" }),
      await call("POST", `/services/${serviceId}/editor/discard`, {}, kofi),
    ]) {
      expect(Problem.parse(response.json())).toMatchObject({
        status: 502,
        detail:
          "The editor reads the repo with the project owner's GitHub token, and GitHub refused it. Ask ama-owusu to sign out of Lift and sign in again.",
      });
    }
    expect(repo.calls.filter((entry) => entry.method !== "GET")).toEqual([]);
    expect(await deploymentsOf(serviceId)).toEqual([]);
    const resets = collab.calls.slice(collabCalls).filter((entry) => entry.path.endsWith("/reset"));
    expect(resets).toEqual([]);
    expect((await changes(serviceId)).map((change) => change.path)).toEqual(["server.js"]);
  });

  it("discards every draft without paths, for everyone editing", async () => {
    const serviceId = await newService();
    await drafts(serviceId, { "server.js": "app.listen(8080);\n", "README.md": "# Mine\n" });
    const response = await call("POST", `/services/${serviceId}/editor/discard`, {}, kofi);
    expect(EditorDiscardResponse.parse(response.json())).toEqual({
      paths: ["README.md", "server.js"],
    });
    expect(await changes(serviceId)).toEqual([]);
    const resets = collab.calls.filter((entry) => entry.path.endsWith("/reset"));
    expect(resets.at(-1)?.body).toEqual({
      documents: [
        { name: editorDocumentName(serviceId, "README.md"), text: "# next-hello\n" },
        { name: editorDocumentName(serviceId, "server.js"), text: SERVER },
      ],
    });
  });
});
