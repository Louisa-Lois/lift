import { createHash } from "node:crypto";
import { type Db, schema } from "@lift/db";
import {
  COLLAB_TEXT_NAME,
  EDITOR_LIMITS,
  type EditorSession,
  type EditorTree,
  editorDocumentName,
  type GithubFile,
  newId,
  type ProjectRole,
  presenceColor,
} from "@lift/shared";
import { signCollabToken } from "@lift/shared/collab-token";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import * as Y from "yjs";
import { problem } from "../lib/problem";
import type { ProjectRow } from "./access";
import type { CollabClient } from "./collab-client";
import type { SecretBox } from "./crypto";
import { type Github, type GithubContents, SYMLINK_MODE } from "./github";
import type { ServiceRow } from "./services";
import type { UserRow } from "./sessions";
import { findUserById, githubTokenOf } from "./users";

const documents = schema.editorDocuments;

export interface EditorDeps {
  db: Db;
  github: Github;
  secretBox: SecretBox | null;
  collab: CollabClient;
  /** Signs the collab tokens; without it the editor answers 503. */
  collabSecret: string | undefined;
  log: FastifyBaseLogger;
}

/**
 * Extensions the editor never opens. GitHub's tree doesn't say which files are binary, so the
 * tree marks them by name; opening a file also checks its bytes are UTF-8 text.
 */
const BINARY_EXTENSIONS = new Set([
  // images
  ...["png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp", "tif", "tiff", "psd", "heic"],
  // fonts
  ...["woff", "woff2", "ttf", "otf", "eot"],
  // audio and video
  ...["mp3", "wav", "ogg", "oga", "flac", "aac", "m4a", "mp4", "m4v", "webm", "mov", "avi", "mkv"],
  // archives and packages
  ...["zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "tar", "jar", "war", "whl"],
  // documents
  ...["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"],
  // compiled code and data
  ...["wasm", "exe", "dll", "so", "dylib", "bin", "o", "a", "class", "pyc", "node", "lockb"],
  ...["db", "sqlite", "sqlite3"],
]);

export function isBinaryPath(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot > 0 && BINARY_EXTENSIONS.has(name.slice(dot + 1));
}

/** The git blob SHA of a text: what GitHub's tree and contents answer for the same bytes. */
export function blobSha(text: string): string {
  const bytes = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/** A Y.Doc holding `text`, as the collab server stores it. */
function yjsStateOf(text: string): Buffer {
  const doc = new Y.Doc();
  doc.getText(COLLAB_TEXT_NAME).insert(0, text);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

/**
 * The project owner's GitHub token. The editor reads the repo as its owner, as builds do, so a
 * member who can't see the repo on GitHub can still open its files in Lift.
 */
async function ownerToken(deps: EditorDeps, project: ProjectRow): Promise<string> {
  const owner = await findUserById(deps.db, project.ownerId);
  if (!owner) throw new Error(`project ${project.id} has no owner`);
  return githubTokenOf(deps.secretBox, owner);
}

/** BE-17: the files the editor lists, at the service's branch unless `ref` says otherwise. */
export async function editorTree(
  deps: EditorDeps,
  service: ServiceRow,
  project: ProjectRow,
  ref: string | undefined,
): Promise<EditorTree> {
  const token = await ownerToken(deps, project);
  const tree = await deps.github.getFiles(
    token,
    service.repoOwner,
    service.repoName,
    ref ?? service.branch,
  );
  if (!tree) {
    const repo = `${service.repoOwner}/${service.repoName}`;
    throw problem(
      "not_found",
      ref
        ? `There's no ${ref} in ${repo}.`
        : `The branch ${service.branch} isn't in ${repo} anymore.`,
    );
  }
  return {
    sha: tree.sha,
    truncated: tree.truncated,
    files: tree.files.map((file) => ({
      path: file.path,
      size: file.size,
      binary: file.mode === SYMLINK_MODE || isBinaryPath(file.path),
    })),
  };
}

const cantOpen = (detail: string, field: string) =>
  problem("validation_failed", detail, { fields: { path: field } });

const tooLarge = () =>
  cantOpen(
    `The editor opens files up to ${EDITOR_LIMITS.maxTextFileBytes / 1024} KB.`,
    "Too large to edit here",
  );

/** The file at the branch head, if the editor can open it; otherwise the problem that says why. */
function editableFile(head: GithubContents, path: string, branch: string): GithubFile {
  switch (head.kind) {
    case "not_found":
      throw problem("not_found", `There's no ${path} on ${branch}.`);
    case "folder":
      throw cantOpen(`${path} is a folder.`, "This is a folder");
    case "binary":
      throw cantOpen("The editor can't open binary files.", "Can't edit binary files");
    case "too_large":
      throw tooLarge();
    case "file":
      // GitHub answers a symlink to a file with that file, under the file's own path.
      if (head.file.path !== path) {
        throw cantOpen(
          `${path} is a link to ${head.file.path}; open that instead.`,
          "This is a link",
        );
      }
      if (head.file.size > EDITOR_LIMITS.maxTextFileBytes) throw tooLarge();
      return head.file;
  }
}

type DocumentRow = Pick<typeof documents.$inferSelect, "id" | "path" | "baseSha" | "updatedAt">;

async function findDocument(db: Db, serviceId: string, path: string): Promise<DocumentRow | null> {
  const [row] = await db
    .select({
      id: documents.id,
      path: documents.path,
      baseSha: documents.baseSha,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(and(eq(documents.serviceId, serviceId), eq(documents.path, path)))
    .limit(1);
  return row ?? null;
}

/** Whether a document's live text differs from where its draft started. */
const hasDraft = (text: string | null | undefined, baseSha: string) =>
  typeof text === "string" && blobSha(text) !== baseSha;

/**
 * Keeps a service under 50 documents before another is created: those without a draft go first,
 * oldest first. With 50 drafts the file can't open until some are committed or discarded.
 */
async function makeRoom(deps: EditorDeps, serviceId: string): Promise<void> {
  const rows = await deps.db
    .select({ id: documents.id, path: documents.path, baseSha: documents.baseSha })
    .from(documents)
    .where(eq(documents.serviceId, serviceId))
    .orderBy(asc(documents.updatedAt));
  const excess = rows.length - (EDITOR_LIMITS.maxOpenDocumentsPerService - 1);
  if (excess <= 0) return;
  const texts = await deps.collab.texts(rows.map((row) => editorDocumentName(serviceId, row.path)));
  const clean = rows.filter(
    (row) => !hasDraft(texts[editorDocumentName(serviceId, row.path)], row.baseSha),
  );
  if (clean.length < excess) {
    throw problem(
      "conflict",
      `${EDITOR_LIMITS.maxOpenDocumentsPerService} files in this service have changes nobody has committed. Commit or discard some, then open this one.`,
    );
  }
  const removed = clean.slice(0, excess).map((row) => row.id);
  await deps.db.delete(documents).where(inArray(documents.id, removed));
}

/** First open: the file's text at the branch head becomes the document. Returns its base SHA. */
async function createDocument(
  deps: EditorDeps,
  service: ServiceRow,
  token: string,
  path: string,
): Promise<string> {
  if (isBinaryPath(path)) {
    throw cantOpen("The editor can't open binary files.", "Can't edit binary files");
  }
  const head = await deps.github.getContents(
    token,
    service.repoOwner,
    service.repoName,
    path,
    service.branch,
  );
  const file = editableFile(head, path, service.branch);
  await makeRoom(deps, service.id);
  const [created] = await deps.db
    .insert(documents)
    .values({
      id: newId("edoc"),
      serviceId: service.id,
      path,
      yjsState: yjsStateOf(file.content),
      baseSha: file.sha,
    })
    .onConflictDoNothing({ target: [documents.serviceId, documents.path] })
    .returning({ baseSha: documents.baseSha });
  if (created) return created.baseSha;
  // Someone else opened it at the same moment, so their document is the one.
  const existing = await findDocument(deps.db, service.id, path);
  if (!existing) throw new Error(`editor document ${path} vanished as it was created`);
  return existing.baseSha;
}

/**
 * A later open: if the file changed on GitHub and nobody has a draft of it, the document reloads
 * from the branch head, for everyone who has it open. A draft is never touched; committing it
 * says the file changed upstream. Returns the base SHA.
 */
async function refreshDocument(
  deps: EditorDeps,
  service: ServiceRow,
  token: string,
  row: DocumentRow,
): Promise<string> {
  let head: GithubContents;
  try {
    head = await deps.github.getContents(
      token,
      service.repoOwner,
      service.repoName,
      row.path,
      service.branch,
    );
  } catch (error) {
    // The document opens without GitHub; only the reload waits.
    deps.log.warn(
      { err: error, path: row.path },
      "couldn't check the editor document against GitHub",
    );
    return row.baseSha;
  }
  if (
    head.kind !== "file" ||
    head.file.sha === row.baseSha ||
    head.file.path !== row.path ||
    head.file.size > EDITOR_LIMITS.maxTextFileBytes
  ) {
    return row.baseSha;
  }
  const name = editorDocumentName(service.id, row.path);
  const texts = await deps.collab.texts([name]);
  if (texts[name] == null || hasDraft(texts[name], row.baseSha)) return row.baseSha;
  await deps.collab.reset([{ name, text: head.file.content }]);
  await deps.db.update(documents).set({ baseSha: head.file.sha }).where(eq(documents.id, row.id));
  return head.file.sha;
}

/**
 * BE-17: opens one file in the live editor. The first open loads it from the branch head; later
 * ones reload it if it moved on GitHub and nobody has a draft. The answer has a 10-minute collab
 * token for this file only: read-only for viewers, which the collab server enforces.
 */
export async function openSession(
  deps: EditorDeps,
  input: {
    service: ServiceRow;
    project: ProjectRow;
    role: ProjectRole;
    user: UserRow;
    path: string;
  },
): Promise<EditorSession> {
  const { service, project, role, user, path } = input;
  if (!deps.collabSecret) {
    throw problem(
      "upstream_unavailable",
      "The live editor isn't set up on this server (COLLAB_SECRET).",
    );
  }
  const token = await ownerToken(deps, project);
  const row = await findDocument(deps.db, service.id, path);
  const baseSha = row
    ? await refreshDocument(deps, service, token, row)
    : await createDocument(deps, service, token, path);
  return {
    documentName: editorDocumentName(service.id, path),
    token: await signCollabToken({ sub: user.id, svc: service.id, path, role }, deps.collabSecret),
    baseSha,
    readOnly: role === "viewer",
    user: {
      id: user.id,
      name: user.name ?? user.login,
      color: presenceColor(user.id),
      avatarUrl: user.avatarUrl,
    },
  };
}
