import { HocuspocusProvider } from "@hocuspocus/provider";
import type { Server } from "@hocuspocus/server";
import { type Db, schema } from "@lift/db";
import { COLLAB_TEXT_NAME, editorDocumentName, newId, type ProjectRole } from "@lift/shared";
import { signCollabToken } from "@lift/shared/collab-token";
import { and, eq } from "drizzle-orm";
import * as Y from "yjs";
import { type CollabOptions, createCollabServer } from "../src/server";

export const SECRET = "collab-test-secret-".padEnd(48, "x");

/** A user, a project and a service to hang documents on. */
export async function seedService(db: Db) {
  const userId = newId("usr");
  const projectId = newId("prj");
  const serviceId = newId("svc");
  await db.insert(schema.users).values({
    id: userId,
    githubId: Math.floor(Math.random() * 1e9),
    login: `ama-${userId.slice(-6)}`,
    avatarUrl: "https://avatars.githubusercontent.com/u/1",
    githubTokenEnc: Buffer.from("not a token"),
  });
  await db
    .insert(schema.projects)
    .values({ id: projectId, name: "Editor", slug: projectId, ownerId: userId });
  await db.insert(schema.services).values({
    id: serviceId,
    projectId,
    name: "api",
    slug: "api",
    type: "web",
    repoOwner: "lift-demo",
    repoName: "express",
    branch: "main",
    rootDir: "/",
    builder: "railpack",
    subdomain: serviceId,
  });
  return { userId, serviceId };
}

/** What the API does when someone first opens a file: a row with the file's text as a Y.Doc. */
export async function seedDocument(db: Db, serviceId: string, path: string, text: string) {
  const doc = new Y.Doc();
  doc.getText(COLLAB_TEXT_NAME).insert(0, text);
  await db.insert(schema.editorDocuments).values({
    id: newId("edoc"),
    serviceId,
    path,
    yjsState: Buffer.from(Y.encodeStateAsUpdate(doc)),
    baseSha: "a".repeat(40),
  });
  return editorDocumentName(serviceId, path);
}

/** The row's saved text and `updated_at`. */
export async function saved(db: Db, serviceId: string, path: string) {
  const [row] = await db
    .select()
    .from(schema.editorDocuments)
    .where(
      and(eq(schema.editorDocuments.serviceId, serviceId), eq(schema.editorDocuments.path, path)),
    );
  if (!row) throw new Error(`no row for ${path}`);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(row.yjsState));
  return { text: doc.getText(COLLAB_TEXT_NAME).toString(), updatedAt: row.updatedAt };
}

export interface RunningCollab {
  server: Server;
  /** `ws://127.0.0.1:{port}` */
  url: string;
  /** `http://127.0.0.1:{port}` */
  baseUrl: string;
  stop: () => Promise<void>;
}

export async function startCollab(db: Db, options: CollabOptions = {}): Promise<RunningCollab> {
  const server = createCollabServer(
    { HOST: "127.0.0.1", COLLAB_PORT: 0, COLLAB_SECRET: SECRET },
    db,
    {
      debounce: 100,
      maxDebounce: 500,
      ...options,
    },
  );
  await server.listen();
  const port = server.address.port;
  return {
    server,
    url: `ws://127.0.0.1:${port}`,
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => server.destroy(),
  };
}

export function tokenFor(
  claims: { sub: string; svc: string; path: string; role?: ProjectRole },
  options: { secret?: string; now?: number } = {},
) {
  return signCollabToken(
    { role: "editor", ...claims },
    options.secret ?? SECRET,
    options.now ?? Date.now(),
  );
}

export class Refused extends Error {
  constructor(readonly reason: string) {
    super(`refused: ${reason}`);
  }
}

export interface Client {
  provider: HocuspocusProvider;
  text: Y.Text;
  close: () => void;
}

/** Connects a provider as the browser does; resolves once synced, rejects if refused. */
export function connect(url: string, name: string, token: string): Promise<Client> {
  const document = new Y.Doc();
  return new Promise((resolve, reject) => {
    const provider = new HocuspocusProvider({
      url,
      name,
      document,
      token,
      onSynced: () =>
        resolve({
          provider,
          text: document.getText(COLLAB_TEXT_NAME),
          close: () => provider.destroy(),
        }),
      onAuthenticationFailed: ({ reason }) => {
        provider.destroy();
        reject(new Refused(reason));
      },
    });
  });
}

/** Calls an internal route as the API does. */
export function callInternal(
  collab: RunningCollab,
  route: "text" | "reset",
  body: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${SECRET}` },
) {
  return fetch(`${collab.baseUrl}/internal/documents/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
