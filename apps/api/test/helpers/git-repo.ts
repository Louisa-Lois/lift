import { createHash } from "node:crypto";
import { gitBlobSha } from "./github";

type Tree = Map<string, { mode: string; sha: string }>;

export interface GitCall {
  method: string;
  /** The path after `/repos/{owner}/{name}/`. */
  path: string;
  body: unknown;
  authorization: string | null;
}

interface GitWrite {
  content?: string;
  encoding?: string;
  base_tree?: string;
  tree?: { path: string; mode: string; type: string; sha: string }[] | string;
  parents?: string[];
  message?: string;
  sha?: string;
  force?: boolean;
}

/**
 * One GitHub repo with real history, for the editor's commit tests (docs/prd/01-backend-api.md,
 * "Testing": GitHub is recorded, never reached). The commits, trees and contents routes read it;
 * the Git Data routes (blobs, trees, commits, refs) write to it as GitHub does, so a commit
 * really moves the branch. Anything else returns null, for the next fake to answer.
 */
export function fakeGitRepo(options: {
  owner: string;
  name: string;
  branch: string;
  files: Record<string, string>;
  modes?: Record<string, string>;
}) {
  const blobs = new Map<string, string>();
  const trees = new Map<string, Tree>();
  const commits = new Map<string, { tree: string; parents: string[]; message: string }>();
  const refs = new Map<string, string>();
  const calls: GitCall[] = [];
  const state = {
    protected: false,
    /** Tokens of people who can read the repo but not push to it. */
    readOnly: new Set<string>(),
    /** Tokens GitHub no longer accepts, as once revoked: every call with one gets 401. */
    refused: new Set<string>(),
    /** Runs as GitHub receives the branch update, before it answers. */
    beforeFastForward: null as null | ((sha: string) => Promise<void> | void),
  };
  let written = 0;
  const sha1 = (value: string) => createHash("sha1").update(value).digest("hex");

  const writeBlob = (content: string) => {
    const sha = gitBlobSha(content);
    blobs.set(sha, content);
    return sha;
  };
  const writeTree = (tree: Tree) => {
    const sha = sha1(`tree ${JSON.stringify([...tree].sort())}`);
    trees.set(sha, tree);
    return sha;
  };
  const writeCommit = (tree: string, parents: string[], message: string) => {
    written += 1;
    const sha = sha1(`commit ${tree} ${parents.join(",")} ${message} ${written}`);
    commits.set(sha, { tree, parents, message });
    return sha;
  };

  const head = () => refs.get(options.branch) ?? "";
  const resolve = (ref: string) => refs.get(ref) ?? (commits.has(ref) ? ref : undefined);
  const treeAt = (commitSha: string): Tree =>
    trees.get(commits.get(commitSha)?.tree ?? "") ?? new Map();

  const initial: Tree = new Map(
    Object.entries(options.files).map(([path, content]) => [
      path,
      { mode: options.modes?.[path] ?? "100644", sha: writeBlob(content) },
    ]),
  );
  refs.set(options.branch, writeCommit(writeTree(initial), [], "Initial commit"));

  /** Someone pushes to the branch from elsewhere; `null` deletes a file. */
  function push(changes: Record<string, string | null>) {
    const tree = new Map(treeAt(head()));
    for (const [path, content] of Object.entries(changes)) {
      if (content === null) tree.delete(path);
      else tree.set(path, { mode: tree.get(path)?.mode ?? "100644", sha: writeBlob(content) });
    }
    refs.set(options.branch, writeCommit(writeTree(tree), [head()], "A push from elsewhere"));
  }

  /** A file at a commit (the branch head without one): its text and mode. */
  function fileAt(path: string, ref = options.branch) {
    const entry = treeAt(resolve(ref) ?? "").get(path);
    return entry ? { text: blobs.get(entry.sha) ?? "", mode: entry.mode, sha: entry.sha } : null;
  }

  const notFound = () => Response.json({ message: "Not Found" }, { status: 404 });

  /** Answers a request for this repo's history or Git data, recording it; null for the rest. */
  async function handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const prefix = `/repos/${options.owner}/${options.name}/`;
    if (url.host !== "api.github.com" || !url.pathname.startsWith(prefix)) return null;
    const rest = url.pathname.slice(prefix.length).split("/").map(decodeURIComponent).join("/");
    if (!/^(?:commits|contents|git)\//.test(rest)) return null;
    const body = (request.method === "GET" ? undefined : await request.json()) as GitWrite;
    const authorization = request.headers.get("authorization");
    const response = await answer(request, url, rest, body, authorization);
    if (response) calls.push({ method: request.method, path: rest, body, authorization });
    return response;
  }

  async function answer(
    request: Request,
    url: URL,
    rest: string,
    body: GitWrite,
    authorization: string | null,
  ): Promise<Response | null> {
    const token = authorization?.replace(/^Bearer /, "") ?? "";
    if (state.refused.has(token)) {
      return Response.json({ message: "Bad credentials" }, { status: 401 });
    }
    if (request.method === "GET" && rest.startsWith("commits/")) {
      const sha = resolve(rest.slice("commits/".length));
      const commit = sha ? commits.get(sha) : undefined;
      if (!sha || !commit) return Response.json({ message: "No commit found" }, { status: 422 });
      return Response.json({
        sha,
        commit: {
          message: commit.message,
          author: { name: "Someone" },
          tree: { sha: commit.tree },
        },
        author: { login: "someone" },
      });
    }
    if (request.method === "GET" && rest.startsWith("git/trees/")) {
      const sha = rest.slice("git/trees/".length);
      const tree = trees.get(sha);
      if (!tree) return notFound();
      const folders = new Set<string>();
      const entries = [...tree].map(([path, entry]) => {
        const parts = path.split("/");
        for (let i = 1; i < parts.length; i += 1) folders.add(parts.slice(0, i).join("/"));
        const size = Buffer.byteLength(blobs.get(entry.sha) ?? "");
        return { path, mode: entry.mode, type: "blob", sha: entry.sha, size };
      });
      for (const path of folders)
        entries.push({ path, mode: "040000", type: "tree", sha, size: 0 });
      return Response.json({ sha, truncated: false, tree: entries });
    }
    if (request.method === "GET" && rest.startsWith("contents/")) {
      const path = rest.slice("contents/".length);
      const sha = resolve(url.searchParams.get("ref") ?? options.branch);
      if (!sha) return notFound();
      const entry = treeAt(sha).get(path);
      if (!entry) {
        const inside = [...treeAt(sha).keys()].filter((file) => file.startsWith(`${path}/`));
        return inside.length > 0
          ? Response.json(inside.map((file) => ({ type: "file", path: file, size: 1 })))
          : notFound();
      }
      const bytes = Buffer.from(blobs.get(entry.sha) ?? "", "utf8");
      return Response.json({
        type: "file",
        path,
        sha: entry.sha,
        size: bytes.length,
        encoding: "base64",
        content: bytes.toString("base64"),
      });
    }

    if (request.method !== "GET" && state.readOnly.has(token)) return notFound();
    if (request.method === "POST" && rest === "git/blobs") {
      const content =
        body.encoding === "base64"
          ? Buffer.from(body.content ?? "", "base64").toString("utf8")
          : (body.content ?? "");
      return Response.json({ sha: writeBlob(content) }, { status: 201 });
    }
    if (request.method === "POST" && rest === "git/trees") {
      const base = trees.get(body.base_tree ?? "");
      if (!base || !Array.isArray(body.tree)) {
        return Response.json({ message: "Invalid tree" }, { status: 422 });
      }
      const tree = new Map(base);
      for (const entry of body.tree) tree.set(entry.path, { mode: entry.mode, sha: entry.sha });
      return Response.json({ sha: writeTree(tree) }, { status: 201 });
    }
    if (request.method === "POST" && rest === "git/commits") {
      const sha = writeCommit(String(body.tree), body.parents ?? [], body.message ?? "");
      return Response.json({ sha }, { status: 201 });
    }
    if (request.method === "PATCH" && rest === `git/refs/heads/${options.branch}`) {
      await state.beforeFastForward?.(body.sha ?? "");
      if (state.protected) {
        return Response.json(
          { message: `Protected branch update failed for refs/heads/${options.branch}.` },
          { status: 422 },
        );
      }
      const commit = commits.get(body.sha ?? "");
      if (!commit || (!body.force && commit.parents[0] !== head())) {
        return Response.json({ message: "Update is not a fast forward" }, { status: 422 });
      }
      refs.set(options.branch, body.sha ?? "");
      return Response.json({
        ref: `refs/heads/${options.branch}`,
        object: { sha: body.sha, type: "commit" },
      });
    }
    return null;
  }

  return { handle, push, fileAt, head, calls, state, commitOf: (sha: string) => commits.get(sha) };
}
