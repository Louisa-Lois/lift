import type { Db } from "@lift/db";
import { createTestDatabase, type TestDatabase } from "@lift/db/testing";
import { editorDocumentName } from "@lift/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type Client,
  callInternal,
  connect,
  Refused,
  type RunningCollab,
  SECRET,
  saved,
  seedDocument,
  seedService,
  startCollab,
  tokenFor,
} from "./helpers";

let database: TestDatabase;
let db: Db;
let userId: string;
let serviceId: string;
let collab: RunningCollab;
const clients: Client[] = [];
const servers: RunningCollab[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  ({ userId, serviceId } = await seedService(db));
  collab = await startCollab(db);
}, 60_000);

afterEach(() => {
  for (const client of clients.splice(0)) client.close();
  vi.restoreAllMocks();
});

afterAll(async () => {
  for (const server of servers) await server.stop();
  await collab?.stop();
  await database?.drop();
});

/** Opens `path` as `role`, the way the editor does with the session the API gave it. */
async function open(path: string, role: "editor" | "viewer" = "editor", on = collab) {
  const client = await connect(
    on.url,
    editorDocumentName(serviceId, path),
    await tokenFor({ sub: userId, svc: serviceId, path, role }),
  );
  clients.push(client);
  return client;
}

/** Hocuspocus logs every refused connection with its stack; keep the test output readable. */
const quietRefusals = () => vi.spyOn(console, "error").mockImplementation(() => {});

describe("connecting", () => {
  it("lets a valid token in to its own document, which starts from the saved text", async () => {
    await seedDocument(db, serviceId, "server.js", "app.listen(3000);\n");
    const client = await open("server.js");
    expect(client.text.toString()).toBe("app.listen(3000);\n");
    expect(client.provider.authorizedScope).toBe("read-write");
  });

  it("refuses an expired, forged or other document's token, and a document with no row", async () => {
    quietRefusals();
    const name = await seedDocument(db, serviceId, "guarded.js", "secret plans");
    const claims = { sub: userId, svc: serviceId, path: "guarded.js" };
    const refusals = [
      await tokenFor(claims, { now: Date.now() - 11 * 60_000 }),
      await tokenFor(claims, { secret: "another-secret".padEnd(48, "y") }),
      await tokenFor({ ...claims, path: "server.js" }),
      await tokenFor({ ...claims, svc: "svc_000000000000000000000000" }),
      "not-a-token",
    ];
    for (const token of refusals) {
      await expect(connect(collab.url, name, token)).rejects.toBeInstanceOf(Refused);
    }
    // A valid token for a file the API never opened gets no empty document to type into.
    await expect(open("never-opened.js")).rejects.toMatchObject({ reason: "document-not-found" });
  });
});

describe("editing together", () => {
  it("shows each editor's typing to the other within a second", async () => {
    await seedDocument(db, serviceId, "together.js", "const a = 1;\n");
    const hakim = await open("together.js");
    const david = await open("together.js");

    hakim.text.insert(0, "// Hakim\n");
    await vi.waitFor(() => expect(david.text.toString()).toBe("// Hakim\nconst a = 1;\n"), {
      timeout: 1_000,
      interval: 10,
    });
    david.text.insert(david.text.length, "// David\n");
    await vi.waitFor(
      () => expect(hakim.text.toString()).toBe("// Hakim\nconst a = 1;\n// David\n"),
      { timeout: 1_000, interval: 10 },
    );
  });

  it("drops a viewer's edits", async () => {
    await seedDocument(db, serviceId, "readonly.js", "look, don't touch\n");
    const editor = await open("readonly.js");
    const viewer = await open("readonly.js", "viewer");
    expect(viewer.provider.authorizedScope).toBe("readonly");

    viewer.text.insert(0, "touched! ");
    editor.text.insert(0, "// fine\n");
    await vi.waitFor(() => expect(viewer.text.toString()).toContain("// fine\n"), {
      timeout: 1_000,
    });
    // The editor's change reached the viewer; the viewer's never reached anyone.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(editor.text.toString()).toBe("// fine\nlook, don't touch\n");
    const response = await callInternal(collab, "text", {
      names: [editorDocumentName(serviceId, "readonly.js")],
    });
    const { texts } = (await response.json()) as { texts: Record<string, string | null> };
    expect(Object.values(texts)).toEqual(["// fine\nlook, don't touch\n"]);
  });

  it("saves edits to editor_documents, and on shutdown, so a restart keeps them", async () => {
    await seedDocument(db, serviceId, "durable.js", "one");
    const first = await startCollab(db, { debounce: 100, maxDebounce: 500 });
    const client = await open("durable.js", "editor", first);
    client.text.insert(3, " two");
    await vi.waitFor(
      async () => expect((await saved(db, serviceId, "durable.js")).text).toBe("one two"),
      {
        timeout: 2_000,
        interval: 50,
      },
    );

    // An edit still waiting for its save when the server stops is saved before it exits.
    const slow = await startCollab(db, { debounce: 60_000, maxDebounce: 60_000 });
    const writer = await open("durable.js", "editor", slow);
    // The two servers don't share memory: this one loaded the saved text.
    expect(writer.text.toString()).toBe("one two");
    client.close();
    await first.stop();
    writer.text.insert(7, " three");
    await vi.waitFor(() => expect(writer.provider.hasUnsyncedChanges).toBe(false));
    writer.close();
    await slow.stop();
    expect((await saved(db, serviceId, "durable.js")).text).toBe("one two three");

    const restarted = await startCollab(db);
    servers.push(restarted);
    expect((await open("durable.js", "editor", restarted)).text.toString()).toBe("one two three");
  });
});

describe("the internal routes", () => {
  it("need COLLAB_SECRET as a bearer token, and answer 404 to anything Traefik forwarded", async () => {
    const body = { names: [editorDocumentName(serviceId, "server.js")] };
    expect((await callInternal(collab, "text", body, {})).status).toBe(401);
    expect(
      (await callInternal(collab, "text", body, { authorization: "Bearer wrong" })).status,
    ).toBe(401);
    expect((await callInternal(collab, "text", body, { authorization: SECRET })).status).toBe(401);
    expect(
      (
        await callInternal(collab, "text", body, {
          authorization: `Bearer ${SECRET}`,
          "x-forwarded-for": "203.0.113.9",
        })
      ).status,
    ).toBe(404);
    expect((await callInternal(collab, "text", { names: [] })).status).toBe(400);
    const get = await fetch(`${collab.baseUrl}/internal/documents/text`, {
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(get.status).toBe(405);
    const unknown = await fetch(`${collab.baseUrl}/internal/documents/delete`, {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(unknown.status).toBe(404);
  });

  it("read each document's live text, edits not yet saved included, and save it", async () => {
    quietRefusals();
    const name = await seedDocument(db, serviceId, "live.js", "original\n");
    const slow = await startCollab(db, { debounce: 60_000, maxDebounce: 60_000 });
    servers.push(slow);
    const client = await open("live.js", "editor", slow);
    client.text.insert(0, "// draft\n");
    await vi.waitFor(() => expect(client.provider.hasUnsyncedChanges).toBe(false));
    expect((await saved(db, serviceId, "live.js")).text).toBe("original\n");

    const missing = editorDocumentName(serviceId, "missing.js");
    const response = await callInternal(slow, "text", { names: [name, missing] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      texts: { [name]: "// draft\noriginal\n", [missing]: null },
    });
    expect((await saved(db, serviceId, "live.js")).text).toBe("// draft\noriginal\n");
  });

  it("leave a document they only read as it was saved", async () => {
    const name = await seedDocument(db, serviceId, "untouched.js", "same\n");
    const before = await saved(db, serviceId, "untouched.js");
    await callInternal(collab, "text", { names: [name] });
    expect(await saved(db, serviceId, "untouched.js")).toEqual(before);
  });

  it("reset a document for everyone editing it, and save it", async () => {
    quietRefusals();
    const name = await seedDocument(db, serviceId, "reset.js", "from GitHub\n");
    const hakim = await open("reset.js");
    const david = await open("reset.js");
    hakim.text.insert(0, "junk ");
    await vi.waitFor(() => expect(david.text.toString()).toBe("junk from GitHub\n"));

    const missing = editorDocumentName(serviceId, "missing.js");
    const response = await callInternal(collab, "reset", {
      documents: [
        { name, text: "from GitHub, newer\n" },
        { name: missing, text: "x" },
      ],
    });
    expect(await response.json()).toEqual({ reset: [name], missing: [missing] });
    await vi.waitFor(() => {
      expect(hakim.text.toString()).toBe("from GitHub, newer\n");
      expect(david.text.toString()).toBe("from GitHub, newer\n");
    });
    expect((await saved(db, serviceId, "reset.js")).text).toBe("from GitHub, newer\n");
  });
});
