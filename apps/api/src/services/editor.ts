import { createHash } from "node:crypto";
import { type Db, schema } from "@lift/db";
import {
  COLLAB_TEXT_NAME,
  EDITOR_LIMITS,
  type EditorChange,
  type EditorCommit,
  type EditorCommitResponse,
  type EditorDiscardResponse,
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
import * as Y from "yjs";
import { problem } from "../lib/problem";
import type { ProjectRow } from "./access";
import type { CollabClient } from "./collab-client";
import type { SecretBox } from "./crypto";
import { cancelDeployment, createDeployment, type DeploymentDeps, queueBuild } from "./deployments";
import { publishEvents, recordEvent } from "./events";
import { type Github, type GithubContents, isTokenRefused, SYMLINK_MODE } from "./github";
import type { ServiceRow } from "./services";
import type { UserRow } from "./sessions";
import { findUserById, githubTokenOf } from "./users";

const documents = schema.editorDocuments;

/** The database, Redis and queues for the deployment a commit starts, and GitHub and collab. */
export interface EditorDeps extends DeploymentDeps {
  github: Github;
  secretBox: SecretBox | null;
  collab: CollabClient;
  /** Signs the collab tokens; without it the editor answers 503. */
  collabSecret: string | undefined;
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

/** Reads of a service's repo, with its project owner's GitHub token (see `readAsOwner`). */
interface RepoReader {
  getFiles(ref: string): ReturnType<Github["getFiles"]>;
  getContents(path: string, ref: string): ReturnType<Github["getContents"]>;
  getCommit(ref: string): ReturnType<Github["getCommit"]>;
}

/**
 * The editor reads the repo with the project owner's GitHub token, as builds do, so a member who
 * can't see the repo on GitHub can still open its files in Lift. If GitHub refuses that token,
 * only the owner can fix it, by signing in again: anyone else is told whose token it is, rather
 * than to sign in again themselves.
 */
async function readAsOwner(
  deps: EditorDeps,
  service: ServiceRow,
  project: ProjectRow,
  user: UserRow,
): Promise<RepoReader> {
  const owner = await findUserById(deps.db, project.ownerId);
  if (!owner) throw new Error(`project ${project.id} has no owner`);
  const token = githubTokenOf(deps.secretBox, owner);
  const { repoOwner, repoName } = service;
  const naming = <T>(read: Promise<T>): Promise<T> =>
    read.catch((error: unknown) => {
      if (owner.id === user.id || !isTokenRefused(error)) throw error;
      throw problem(
        "github_error",
        `The editor reads the repo with the project owner's GitHub token, and GitHub refused it. Ask ${owner.login} to sign out of Lift and sign in again.`,
      );
    });
  return {
    getFiles: (ref) => naming(deps.github.getFiles(token, repoOwner, repoName, ref)),
    getContents: (path, ref) =>
      naming(deps.github.getContents(token, repoOwner, repoName, path, ref)),
    getCommit: (ref) => naming(deps.github.getCommit(token, repoOwner, repoName, ref)),
  };
}

/** BE-17: the files the editor lists, at the service's branch unless `ref` says otherwise. */
export async function editorTree(
  deps: EditorDeps,
  input: { service: ServiceRow; project: ProjectRow; user: UserRow; ref: string | undefined },
): Promise<EditorTree> {
  const { service, project, user, ref } = input;
  const reader = await readAsOwner(deps, service, project, user);
  const tree = await reader.getFiles(ref ?? service.branch);
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
  reader: RepoReader,
  path: string,
): Promise<string> {
  if (isBinaryPath(path)) {
    throw cantOpen("The editor can't open binary files.", "Can't edit binary files");
  }
  const head = await reader.getContents(path, service.branch);
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
  reader: RepoReader,
  row: DocumentRow,
): Promise<string> {
  let head: GithubContents;
  try {
    head = await reader.getContents(row.path, service.branch);
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
  const reader = await readAsOwner(deps, service, project, user);
  const row = await findDocument(deps.db, service.id, path);
  const baseSha = row
    ? await refreshDocument(deps, service, reader, row)
    : await createDocument(deps, service, reader, path);
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

/** One commit or discard at a time for each service, in this process (the API runs as one). */
const busy = new Map<string, Promise<unknown>>();

async function oneAtATime<T>(serviceId: string, work: () => Promise<T>): Promise<T> {
  const run = (busy.get(serviceId) ?? Promise.resolve()).catch(() => undefined).then(work);
  busy.set(serviceId, run);
  try {
    return await run;
  } finally {
    if (busy.get(serviceId) === run) busy.delete(serviceId);
  }
}

interface Draft {
  row: DocumentRow;
  text: string;
}

/** The service's documents whose live text differs from their base, by path. */
async function draftsOf(deps: EditorDeps, serviceId: string): Promise<Draft[]> {
  const rows = await deps.db
    .select({
      id: documents.id,
      path: documents.path,
      baseSha: documents.baseSha,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(eq(documents.serviceId, serviceId))
    .orderBy(asc(documents.path));
  if (rows.length === 0) return [];
  const texts = await deps.collab.texts(rows.map((row) => editorDocumentName(serviceId, row.path)));
  return rows.flatMap((row) => {
    const text = texts[editorDocumentName(serviceId, row.path)];
    return typeof text === "string" && blobSha(text) !== row.baseSha ? [{ row, text }] : [];
  });
}

/** BE-18: the files with drafts, which a commit would include. */
export async function listChanges(deps: EditorDeps, service: ServiceRow): Promise<EditorChange[]> {
  return (await draftsOf(deps, service.id)).map(({ row }) => ({
    path: row.path,
    baseSha: row.baseSha,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

const subjectOf = (message: string) => message.split("\n", 1)[0]?.trim().slice(0, 500) || null;

/**
 * BE-18, Commit & deploy (decision 7 of the Nov 26 plan):
 * 1. Read each draft's live text from collab, and the branch head with each file's blob SHA.
 * 2. A file that changed on GitHub since its draft started is a 409, named in `fields`.
 * 3. Write the blobs, a tree on the head's (keeping each file's mode) and the commit, with the
 *    user's own token, so the commit is theirs.
 * 4. Create the `editor` deployment before the branch moves, so the push webhook that follows
 *    always finds it and skips. Then fast-forward the branch, never forcing, and queue the build.
 *    If the branch won't move, the deployment is canceled and nothing was committed: 409 when
 *    someone pushed meanwhile, 502 otherwise (a protected branch, say).
 * 5. Move each document's base to the commit, record it, and emit `editor.committed`.
 */
export async function commitChanges(
  deps: EditorDeps,
  input: {
    service: ServiceRow;
    project: ProjectRow;
    user: UserRow;
    message: string;
    paths: string[] | undefined;
  },
): Promise<EditorCommitResponse> {
  const { service, project, user } = input;
  return oneAtATime(service.id, async () => {
    const drafts = await draftsOf(deps, service.id);
    const unknown = (input.paths ?? []).filter(
      (path) => !drafts.some((draft) => draft.row.path === path),
    );
    if (unknown.length > 0) {
      throw problem("validation_failed", `No changes to commit in ${unknown.join(", ")}.`, {
        fields: { paths: "Pick files that have changes" },
      });
    }
    const chosen = input.paths
      ? drafts.filter((draft) => input.paths?.includes(draft.row.path))
      : drafts;
    if (chosen.length === 0) {
      throw problem("validation_failed", "Nothing to commit: every file matches the last commit.");
    }

    const { repoOwner: owner, repoName: name, branch } = service;
    const reader = await readAsOwner(deps, service, project, user);
    const head = await reader.getFiles(branch);
    if (!head) throw problem("github_error", `Couldn't read ${branch} in ${owner}/${name}.`);
    const upstream = new Map(head.files.map((file) => [file.path, file]));
    const conflicts: Record<string, string> = {};
    for (const { row } of chosen) {
      let sha = upstream.get(row.path)?.sha;
      // GitHub lists at most 5,000 files of a big repo; ask about the others one by one.
      if (!sha && head.truncated) {
        const found = await reader.getContents(row.path, head.sha);
        if (found.kind === "file") sha = found.file.sha;
      }
      if (!sha) conflicts[row.path] = "Deleted on GitHub since you opened it";
      else if (sha !== row.baseSha) conflicts[row.path] = "Changed on GitHub since you opened it";
    }
    if (Object.keys(conflicts).length > 0) {
      throw problem(
        "conflict",
        "Some files changed on GitHub since you opened them. Discard and reload them, then make your change again.",
        { fields: conflicts },
      );
    }

    const token = githubTokenOf(deps.secretBox, user);
    const commit = await deps.github.writeCommit(token, owner, name, {
      parent: head.sha,
      baseTree: head.treeSha,
      message: input.message,
      files: chosen.map(({ row, text }) => ({
        path: row.path,
        mode: upstream.get(row.path)?.mode ?? "100644",
        content: text,
      })),
    });
    const deployment = await createDeployment(deps, {
      service,
      trigger: "editor",
      commit: { sha: commit.sha, message: subjectOf(input.message), author: user.login },
      actor: { type: "user", id: user.id },
    });
    if (!deployment) throw new Error(`commit ${commit.sha} was deployed before its branch moved`);
    if (!(await deps.github.fastForward(token, owner, name, branch, commit.sha))) {
      await cancelDeployment(deps, {
        deployment,
        actor: { type: "system", id: null },
        by: "Lift",
        message: `${branch} didn't move, so nothing was committed`,
      });
      const now = await reader.getCommit(branch);
      if (now && now.sha !== head.sha) {
        throw problem(
          "conflict",
          `Someone pushed to ${branch} while you were committing, so nothing was committed. Commit again.`,
        );
      }
      throw problem(
        "github_error",
        `GitHub wouldn't move ${branch}; it may be protected. Nothing was committed.`,
      );
    }
    // The commit has landed: a build that can't be queued fails its deployment, which says so.
    await queueBuild(deps, deployment, service).catch(() => undefined);

    const event = await deps.db.transaction(async (tx) => {
      for (const { row, text } of chosen) {
        await tx
          .update(documents)
          .set({ baseSha: commit.blobs[row.path] ?? blobSha(text) })
          .where(eq(documents.id, row.id));
      }
      const [record] = await tx
        .insert(schema.editorCommits)
        .values({
          id: newId("ecm"),
          serviceId: service.id,
          commitSha: commit.sha,
          message: input.message,
          paths: chosen.map(({ row }) => row.path),
          authorUserId: user.id,
          deploymentId: deployment.id,
        })
        .returning();
      if (!record) throw new Error("insert returned no editor commit");
      const data: EditorCommit = {
        id: record.id,
        serviceId: record.serviceId,
        commitSha: record.commitSha,
        message: record.message,
        paths: record.paths,
        authorUserId: record.authorUserId,
        deploymentId: record.deploymentId,
        createdAt: record.createdAt.toISOString(),
      };
      return recordEvent(tx, {
        projectId: service.projectId,
        actorType: "user",
        actorId: user.id,
        type: "editor.committed",
        data,
      });
    });
    await publishEvents(deps.redis, [event], deps.log);
    return { commitSha: commit.sha, deploymentId: deployment.id };
  });
}

/**
 * BE-18: reloads drafts from the branch head, all of them without `paths`. Each document resets
 * through collab, so everyone editing it sees the reload, and its base moves to the head. A file
 * that's gone from the branch (or can't be edited any more) loses its document.
 */
export async function discardChanges(
  deps: EditorDeps,
  input: { service: ServiceRow; project: ProjectRow; user: UserRow; paths: string[] | undefined },
): Promise<EditorDiscardResponse> {
  const { service, project, user } = input;
  return oneAtATime(service.id, async () => {
    const rows = input.paths
      ? await deps.db
          .select({
            id: documents.id,
            path: documents.path,
            baseSha: documents.baseSha,
            updatedAt: documents.updatedAt,
          })
          .from(documents)
          .where(and(eq(documents.serviceId, service.id), inArray(documents.path, input.paths)))
          .orderBy(asc(documents.path))
      : (await draftsOf(deps, service.id)).map(({ row }) => row);
    if (rows.length === 0) return { paths: [] };
    const reader = await readAsOwner(deps, service, project, user);
    const reloaded: { row: DocumentRow; file: GithubFile }[] = [];
    const gone: string[] = [];
    for (const row of rows) {
      const head = await reader.getContents(row.path, service.branch);
      if (
        head.kind === "file" &&
        head.file.path === row.path &&
        head.file.size <= EDITOR_LIMITS.maxTextFileBytes
      ) {
        reloaded.push({ row, file: head.file });
      } else {
        gone.push(row.id);
      }
    }
    await deps.collab.reset(
      reloaded.map(({ row, file }) => ({
        name: editorDocumentName(service.id, row.path),
        text: file.content,
      })),
    );
    await deps.db.transaction(async (tx) => {
      for (const { row, file } of reloaded) {
        await tx.update(documents).set({ baseSha: file.sha }).where(eq(documents.id, row.id));
      }
      if (gone.length > 0) await tx.delete(documents).where(inArray(documents.id, gone));
    });
    return { paths: rows.map((row) => row.path) };
  });
}
