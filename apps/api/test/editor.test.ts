import { randomBytes } from "node:crypto";
import { schema } from "@lift/db";
import { createTestDatabase, type TestDatabase } from "@lift/db/testing";
import {
  API_BASE_PATH,
  COLLAB_INTERNAL_ROUTES,
  COLLAB_TEXT_NAME,
  EditorSession,
  EditorTree,
  editorDocumentName,
  newId,
  Problem,
  ProjectDetail,
  presenceColor,
  REDIS_STREAMS,
  Service,
  User,
} from "@lift/shared";
import { verifyCollabToken } from "@lift/shared/collab-token";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { buildTestApp } from "./helpers/app";
import { fakeCollab, savedText, TEST_COLLAB_SECRET } from "./helpers/collab";
import { BIG_FILE, fakeGithub, gitBlobSha, REPO_FILES } from "./helpers/github";
import { as, signIn } from "./helpers/session";

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const queuePrefix = `test-${randomBytes(4).toString("hex")}`;
const MAIN_SHA = "3f9c2a1b7d4e5f60718293a4b5c6d7e8f9012345";
const OWNER_TOKEN = "gho_owner".padEnd(40, "o");
const SERVER_JS = "app.listen(3000);\n";

/** next-hello, as the editor tests see it; a test changes a file to play a push. */
const files: Record<string, string | Uint8Array> = {
  ...REPO_FILES,
  "server.js": SERVER_JS,
  "data/seed.sql": "-- 600 KB of seed data\n".padEnd(600_000, "x"),
  "bin/blob.dat": new Uint8Array([1, 2, 0, 3]),
};
const github = fakeGithub({
  accessToken: OWNER_TOKEN,
  files,
  symlinks: { "current.js": "server.js" },
});

/** While set, reads of this file wait for each other in pairs, so two opens really race. */
let racing: string | null = null;
const waiting: (() => void)[] = [];
const githubFetch: typeof globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (racing && url.pathname.endsWith(`/contents/${racing}`)) {
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
      if (waiting.length === 2) {
        for (const release of waiting.splice(0)) release();
      }
      setTimeout(resolve, 2_000);
    });
  }
  return github.fetch(input, init);
};

let database: TestDatabase;
let collab: ReturnType<typeof fakeCollab>;
let app: TestApp;
let other: TestApp;
let owner: string;
let ownerId: string;
let kofi: string;
let kofiId: string;
let projectId: string;
let serviceId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  collab = fakeCollab(database.db);
  app = await buildTestApp(
    database,
    { COLLAB_SECRET: TEST_COLLAB_SECRET },
    { githubFetch, collabFetch: collab.fetch, queuePrefix },
  );
  owner = await signIn(app);
  ownerId = User.parse((await call("GET", "/me")).json()).id;
  // Kofi signs in once, with a GitHub token of his own.
  other = await buildTestApp(
    database,
    {},
    {
      githubFetch: fakeGithub({ login: "kofi-mensah", id: 5151, accessToken: "gho_kofi" }).fetch,
      queuePrefix,
    },
  );
  kofi = await signIn(other);
  kofiId = User.parse((await call("GET", "/me", undefined, kofi)).json()).id;

  projectId = ProjectDetail.parse((await call("POST", "/projects", { name: "Editor" })).json()).id;
  serviceId = Service.parse(
    (
      await call("POST", `/projects/${projectId}/services`, {
        name: "web",
        repo: { owner: "lift-demo", name: "next-hello" },
        branch: "main",
      })
    ).json(),
  ).id;
  await call("POST", `/projects/${projectId}/members`, { login: "kofi-mensah", role: "editor" });
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

const open = (path: string, session = owner, service = serviceId) =>
  call("POST", `/services/${service}/editor/session`, { path }, session);

const documentsOf = (service: string) =>
  database.db
    .select()
    .from(schema.editorDocuments)
    .where(eq(schema.editorDocuments.serviceId, service));

const resets = () => collab.calls.filter((entry) => entry.path === COLLAB_INTERNAL_ROUTES.reset);

describe("the editor's file tree", () => {
  it("lists the service's branch, marking binary files and links, read as the owner", async () => {
    const response = await call("GET", `/services/${serviceId}/editor/tree`, undefined, kofi);
    expect(response.statusCode).toBe(200);
    const tree = EditorTree.parse(response.json());
    expect(tree.sha).toBe(MAIN_SHA);
    const binary = Object.fromEntries(tree.files.map((file) => [file.path, file.binary]));
    expect(binary).toMatchObject({
      "server.js": false,
      "README.md": false,
      "public/logo.png": true,
      "current.js": true,
    });
    // Folders and the submodule aren't files.
    expect(Object.keys(binary)).not.toContain("app");
    expect(Object.keys(binary)).not.toContain("vendor/ui");
    const listing = github.calls.findLast((entry) => entry.url.pathname.includes("/git/trees/"));
    expect(listing?.headers.get("authorization")).toBe(`Bearer ${OWNER_TOKEN}`);
  });

  it("reads another ref when asked, and answers 404 for one that isn't there", async () => {
    const dev = await call("GET", `/services/${serviceId}/editor/tree?ref=dev`);
    expect(EditorTree.parse(dev.json()).sha).toBe("a".repeat(40));
    expect((await call("GET", `/services/${serviceId}/editor/tree?ref=nope`)).statusCode).toBe(404);
  });
});

describe("opening a file", () => {
  it("loads it from the branch head, with a 10-minute token for that file alone", async () => {
    const response = await open("server.js");
    expect(response.statusCode).toBe(200);
    const session = EditorSession.parse(response.json());
    expect(session).toMatchObject({
      documentName: editorDocumentName(serviceId, "server.js"),
      baseSha: gitBlobSha(SERVER_JS),
      readOnly: false,
      user: { id: ownerId, color: presenceColor(ownerId) },
    });
    const claims = await verifyCollabToken(session.token, TEST_COLLAB_SECRET);
    expect(claims).toMatchObject({
      sub: ownerId,
      svc: serviceId,
      path: "server.js",
      role: "owner",
    });
    expect((claims?.exp ?? 0) - Date.now() / 1000).toBeGreaterThan(590);
    expect(await savedText(database.db, session.documentName)).toBe(SERVER_JS);

    // Kofi, an editor, gets the same document. GitHub is read with the owner's token.
    const his = EditorSession.parse((await open("server.js", kofi)).json());
    expect(his.baseSha).toBe(session.baseSha);
    expect((await verifyCollabToken(his.token, TEST_COLLAB_SECRET))?.role).toBe("editor");
    const read = github.calls.findLast((entry) =>
      entry.url.pathname.endsWith("/contents/server.js"),
    );
    expect(read?.headers.get("authorization")).toBe(`Bearer ${OWNER_TOKEN}`);
    expect(await documentsOf(serviceId)).toHaveLength(1);
  });

  it("creates one document when two people open a file at the same moment", async () => {
    // Both read the file from GitHub before either creates the document.
    racing = "README.md";
    const [mine, his] = await Promise.all([open("README.md"), open("README.md", kofi)]).finally(
      () => {
        racing = null;
      },
    );
    expect([mine.statusCode, his.statusCode]).toEqual([200, 200]);
    expect(EditorSession.parse(mine.json()).baseSha).toBe(EditorSession.parse(his.json()).baseSha);
    const rows = (await documentsOf(serviceId)).filter((row) => row.path === "README.md");
    expect(rows).toHaveLength(1);
  });

  it("is read-only for viewers", async () => {
    await call("PATCH", `/projects/${projectId}/members/${kofiId}`, { role: "viewer" });
    try {
      const session = EditorSession.parse((await open("server.js", kofi)).json());
      expect(session.readOnly).toBe(true);
      expect((await verifyCollabToken(session.token, TEST_COLLAB_SECRET))?.role).toBe("viewer");
    } finally {
      await call("PATCH", `/projects/${projectId}/members/${kofiId}`, { role: "editor" });
    }
  });

  it("refuses binary files, links, folders, files over 512 KB, and missing ones", async () => {
    const refused: [string, number, string | null][] = [
      ["public/logo.png", 400, "Can't edit binary files"],
      ["bin/blob.dat", 400, "Can't edit binary files"],
      ["current.js", 400, "This is a link"],
      ["app", 400, "This is a folder"],
      ["data/seed.sql", 400, "Too large to edit here"],
      [BIG_FILE.path, 400, "Too large to edit here"],
      ["missing.js", 404, null],
    ];
    for (const [path, status, field] of refused) {
      const response = await open(path);
      expect(response.statusCode, path).toBe(status);
      if (field) expect(Problem.parse(response.json()).fields, path).toEqual({ path: field });
    }
    const paths = (await documentsOf(serviceId)).map((row) => row.path);
    for (const [path] of refused) expect(paths).not.toContain(path);
  });

  it("reloads a document whose file changed on GitHub, but never one with a draft", async () => {
    const first = EditorSession.parse((await open("app/page.tsx")).json());
    const original = files["app/page.tsx"];
    try {
      // A push changes the file: the next open reloads it, for everyone editing it.
      const pushed = "export default function Page() {\n  return <h1>Hello again</h1>;\n}\n";
      files["app/page.tsx"] = pushed;
      const reloaded = EditorSession.parse((await open("app/page.tsx", kofi)).json());
      expect(reloaded.baseSha).toBe(gitBlobSha(pushed));
      expect(resets().at(-1)).toMatchObject({
        body: { documents: [{ name: first.documentName, text: pushed }] },
        authorization: `Bearer ${TEST_COLLAB_SECRET}`,
      });
      expect(await savedText(database.db, first.documentName)).toBe(pushed);

      // Someone has a draft, and the file changes again: the draft stays, on its base.
      collab.drafts.set(first.documentName, "// a draft\n");
      files["app/page.tsx"] = "export default function Page() {\n  return null;\n}\n";
      const before = resets().length;
      const kept = EditorSession.parse((await open("app/page.tsx")).json());
      expect(kept.baseSha).toBe(reloaded.baseSha);
      expect(resets()).toHaveLength(before);
    } finally {
      collab.drafts.delete(first.documentName);
      files["app/page.tsx"] = original ?? "";
    }
  });

  it("keeps a service to 50 documents, dropping ones without drafts first", async () => {
    const worker = Service.parse(
      (
        await call("POST", `/projects/${projectId}/services`, {
          name: "worker",
          repo: { owner: "lift-demo", name: "next-hello" },
          branch: "main",
        })
      ).json(),
    );
    const names: string[] = [];
    for (let i = 0; i < 50; i += 1) {
      const path = `notes/${String(i).padStart(2, "0")}.txt`;
      const text = `note ${i}\n`;
      const doc = new Y.Doc();
      doc.getText(COLLAB_TEXT_NAME).insert(0, text);
      await database.db.insert(schema.editorDocuments).values({
        id: newId("edoc"),
        serviceId: worker.id,
        path,
        yjsState: Buffer.from(Y.encodeStateAsUpdate(doc)),
        baseSha: gitBlobSha(text),
        updatedAt: new Date(Date.UTC(2026, 10, 1, 0, i)),
      });
      names.push(editorDocumentName(worker.id, path));
    }
    try {
      // The two oldest have drafts, so the third oldest makes room.
      collab.drafts.set(names[0] ?? "", "changed\n");
      collab.drafts.set(names[1] ?? "", "changed\n");
      expect((await open("server.js", owner, worker.id)).statusCode).toBe(200);
      const paths = (await documentsOf(worker.id)).map((row) => row.path);
      expect(paths).toHaveLength(50);
      expect(paths).toEqual(expect.arrayContaining(["notes/00.txt", "notes/01.txt", "server.js"]));
      expect(paths).not.toContain("notes/02.txt");

      // With a draft in every document, another file can't open.
      for (const name of [...names, editorDocumentName(worker.id, "server.js")]) {
        collab.drafts.set(name, "changed\n");
      }
      const full = await open("README.md", owner, worker.id);
      expect(Problem.parse(full.json())).toMatchObject({ status: 409, code: "conflict" });
      expect(await documentsOf(worker.id)).toHaveLength(50);
    } finally {
      collab.drafts.clear();
    }
  });

  it("answers 503 on a server without COLLAB_SECRET", async () => {
    const bare = await buildTestApp(database, {}, { githubFetch: github.fetch, queuePrefix });
    try {
      const response = await bare.inject({
        method: "POST",
        url: `${API_BASE_PATH}/services/${serviceId}/editor/session`,
        ...as(owner),
        payload: { path: "server.js" },
      });
      expect(Problem.parse(response.json())).toMatchObject({
        status: 503,
        detail: "The live editor isn't set up on this server (COLLAB_SECRET).",
      });
    } finally {
      await bare.close();
    }
  });
});
