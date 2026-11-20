import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// GitHub is mocked with recorded responses (docs/prd/01-backend-api.md, "Testing"): the shapes
// of real answers, trimmed, for a fictional user and the lift-demo organisation.
const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/github/${name}.json`, import.meta.url), "utf8"));
const TOKEN = fixture("token") as { access_token: string };
const USER = fixture("user") as Record<string, unknown>;
const EMAILS = fixture("emails") as unknown[];
const REPOS = fixture("repos") as { name: string; owner: { login: string } }[];
const BRANCHES = fixture("branches") as { name: string; commit: { sha: string } }[];

/** next-hello's files, for the tree and contents routes; `public/logo.png` isn't text. */
export const REPO_FILES: Record<string, string | Uint8Array> = {
  ".env.example": "# Copy to .env\nGREETING=hello\nAPI_KEY=change-me\nSITE_NAME=your-site\n",
  "package.json": `${JSON.stringify(
    {
      name: "next-hello",
      scripts: { build: "next build", start: "next start" },
      dependencies: { next: "16.0.0", react: "19.2.0" },
    },
    null,
    2,
  )}\n`,
  "README.md": "# next-hello\n\nOne Next.js page, for Lift's tests. Ça marche.\n",
  "app/page.tsx": "export default function Page() {\n  return <h1>Hello</h1>;\n}\n",
  "public/logo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
};
/** A file GitHub lists but won't send inline: over 1 MB. */
export const BIG_FILE = { path: "data/big.json", size: 2_500_000 };

/** A commit's tree: its SHA reversed, which is still 40 hex characters. */
export const treeShaOf = (commitSha: string) => [...commitSha].reverse().join("");

const bytesOf = (content: string | Uint8Array) =>
  typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
/** The git blob SHA of some bytes, as GitHub answers it. */
export const gitBlobSha = (content: string | Uint8Array) => {
  const bytes = bytesOf(content);
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
};

type RepoFiles = Record<string, string | Uint8Array>;

/**
 * Each repo's tree, as `git/trees/{sha}?recursive=1` answers: next-hello has its files (with
 * their folders, any symlinks and a submodule, which aren't files); express-postgres has 6,000
 * files; notes is one GitHub itself truncated.
 */
function treeOf(repo: string, files: RepoFiles, symlinks: Record<string, string>) {
  if (repo === "express-postgres") {
    return {
      truncated: false,
      tree: Array.from({ length: 6_000 }, (_, i) => {
        const path = `src/file-${String(i).padStart(4, "0")}.ts`;
        return { path, mode: "100644", type: "blob", sha: gitBlobSha(path), size: 10 };
      }),
    };
  }
  if (repo === "notes") {
    return {
      truncated: true,
      tree: [{ path: "notes.md", mode: "100644", type: "blob", sha: gitBlobSha("notes"), size: 5 }],
    };
  }
  const folders = new Set<string>();
  const entries: { path: string; mode: string; type: string; sha: string; size?: number }[] = [];
  const add = (entry: (typeof entries)[number]) => {
    const parts = entry.path.split("/");
    for (let i = 1; i < parts.length; i += 1) folders.add(parts.slice(0, i).join("/"));
    entries.push(entry);
  };
  for (const [path, content] of Object.entries(files)) {
    const size = bytesOf(content).length;
    add({ path, mode: "100644", type: "blob", sha: gitBlobSha(content), size });
  }
  const big = { mode: "100644", type: "blob", sha: gitBlobSha(BIG_FILE.path) };
  add({ path: BIG_FILE.path, ...big, size: BIG_FILE.size });
  for (const [path, target] of Object.entries(symlinks)) {
    add({ path, mode: "120000", type: "blob", sha: gitBlobSha(target), size: target.length });
  }
  add({ path: "vendor/ui", mode: "160000", type: "commit", sha: "c".repeat(40) });
  for (const path of folders)
    entries.push({ path, mode: "040000", type: "tree", sha: "d".repeat(40) });
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { truncated: false, tree: entries };
}

/**
 * `contents/{path}`: a file (base64 in 60-character lines, like GitHub), a folder, or 404. A
 * symlink to a file answers with that file, under its own path, as GitHub does.
 */
function contentsOf(path: string, files: RepoFiles, symlinks: Record<string, string>): Response {
  if (path === BIG_FILE.path) {
    return Response.json({
      type: "file",
      path,
      sha: gitBlobSha(BIG_FILE.path),
      size: BIG_FILE.size,
      encoding: "none",
      content: "",
    });
  }
  const target = symlinks[path];
  if (target !== undefined && files[target] !== undefined) {
    return contentsOf(target, files, symlinks);
  }
  const content = files[path];
  if (content !== undefined) {
    const bytes = bytesOf(content);
    return Response.json({
      type: "file",
      path,
      sha: gitBlobSha(content),
      size: bytes.length,
      encoding: "base64",
      content: `${bytes.toString("base64").replace(/.{60}/g, "$&\n")}\n`,
    });
  }
  const children = Object.keys(files).filter((file) => file.startsWith(`${path}/`));
  if (children.length > 0) {
    return Response.json(children.map((file) => ({ type: "file", path: file, size: 1 })));
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
}

export interface RecordedCall {
  method: string;
  url: URL;
  headers: Headers;
  body: string;
}

export interface FakeGithubOptions {
  /** Sign in as someone else than the fixture user. */
  login?: string;
  id?: number;
  failTokenExchange?: boolean;
  /** How GitHub answers a request to add a webhook: 201 (the default), or 403 without admin rights. */
  hookStatus?: number;
  /** The access token the sign-in gets, instead of the fixture's. */
  accessToken?: string;
  /**
   * next-hello's files, instead of REPO_FILES. Read on every call, so a test can change one to
   * play a push.
   */
  files?: RepoFiles;
  /** next-hello's symlinks: path → target. */
  symlinks?: Record<string, string>;
}

/** `rel="next"` when there are more pages, like GitHub's Link header. */
function page<T>(items: T[], url: URL): Response {
  const perPage = Number(url.searchParams.get("per_page") ?? 30);
  const number = Number(url.searchParams.get("page") ?? 1);
  const slice = items.slice((number - 1) * perPage, number * perPage);
  const headers = new Headers();
  if (number * perPage < items.length) {
    const next = new URL(url);
    next.searchParams.set("page", String(number + 1));
    headers.set("link", `<${next}>; rel="next"`);
  }
  return Response.json(slice, { headers });
}

/**
 * A fetch that answers like GitHub and records every call, so tests can check what the API sent
 * (and that tokens only ever go to GitHub).
 */
export function fakeGithub(options: FakeGithubOptions = {}) {
  const calls: RecordedCall[] = [];
  const findRepo = (owner: string, name: string) =>
    REPOS.find((repo) => repo.owner.login === owner && repo.name === name);
  const files = () => options.files ?? REPO_FILES;
  const symlinks = options.symlinks ?? {};

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push({
      method: request.method,
      url,
      headers: request.headers,
      body: await request.text(),
    });
    const route = `${request.method} ${url.host}${url.pathname}`;
    if (route === "POST github.com/login/oauth/access_token") {
      if (options.failTokenExchange) return new Response("Service Unavailable", { status: 503 });
      return Response.json({ ...TOKEN, access_token: options.accessToken ?? TOKEN.access_token });
    }
    if (route === "GET api.github.com/user") {
      return Response.json({
        ...USER,
        ...(options.login ? { login: options.login } : {}),
        ...(options.id ? { id: options.id } : {}),
      });
    }
    if (route === "GET api.github.com/user/emails") return Response.json(EMAILS);
    if (route === "GET api.github.com/user/repos") return page(REPOS, url);
    if (request.method === "DELETE" && url.pathname.startsWith("/applications/")) {
      return new Response(null, { status: 204 });
    }
    const hooksPath = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/hooks(?:\/(\d+))?$/);
    if (url.host === "api.github.com" && hooksPath) {
      if (request.method === "POST" && !hooksPath[3]) {
        const status = options.hookStatus ?? 201;
        return status === 201
          ? Response.json({ id: 4242, name: "web", active: true }, { status: 201 })
          : Response.json({ message: "Not allowed" }, { status });
      }
      if (request.method === "DELETE" && hooksPath[3]) return new Response(null, { status: 204 });
    }
    const commitPath = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/commits\/([^/]+)$/);
    if (request.method === "GET" && url.host === "api.github.com" && commitPath) {
      const [, owner = "", name = "", ref = ""] = commitPath;
      if (!findRepo(decodeURIComponent(owner), decodeURIComponent(name))) {
        return new Response("Not Found", { status: 404 });
      }
      // A branch name or one of the branches' head SHAs; GitHub answers 422 for an unknown SHA.
      const wanted = decodeURIComponent(ref);
      const head = BRANCHES.find((entry) => entry.name === wanted || entry.commit.sha === wanted);
      if (!head)
        return Response.json({ message: `No commit found for SHA: ${wanted}` }, { status: 422 });
      return Response.json({
        sha: head.commit.sha,
        commit: {
          message: `Update the ${head.name} landing page\n\nA body Lift doesn't keep.`,
          author: { name: "Ama Owusu" },
          tree: { sha: treeShaOf(head.commit.sha) },
        },
        author: { login: "ama-owusu" },
      });
    }
    const treePath = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/git\/trees\/([0-9a-f]{40})$/);
    if (request.method === "GET" && url.host === "api.github.com" && treePath) {
      const [, owner = "", name = "", sha = ""] = treePath;
      const known = BRANCHES.some((entry) => treeShaOf(entry.commit.sha) === sha);
      if (!findRepo(decodeURIComponent(owner), decodeURIComponent(name)) || !known) {
        return new Response("Not Found", { status: 404 });
      }
      if (url.searchParams.get("recursive") !== "1") return Response.json({ message: "flat" });
      return Response.json({ sha, ...treeOf(decodeURIComponent(name), files(), symlinks) });
    }
    const contentsPath = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/);
    if (request.method === "GET" && url.host === "api.github.com" && contentsPath) {
      const [, owner = "", name = "", path = ""] = contentsPath;
      const ref = url.searchParams.get("ref");
      const knownRef =
        ref === null || BRANCHES.some((entry) => entry.name === ref || entry.commit.sha === ref);
      if (!findRepo(decodeURIComponent(owner), decodeURIComponent(name)) || !knownRef) {
        return Response.json({ message: "Not Found" }, { status: 404 });
      }
      return contentsOf(path.split("/").map(decodeURIComponent).join("/"), files(), symlinks);
    }
    const repoPath = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(\/branches(?:\/([^/]+))?)?$/);
    if (request.method === "GET" && url.host === "api.github.com" && repoPath) {
      const [, owner = "", name = "", branches, branch] = repoPath;
      const repo = findRepo(decodeURIComponent(owner), decodeURIComponent(name));
      if (!repo) return new Response("Not Found", { status: 404 });
      if (!branches) return Response.json(repo);
      if (!branch) return page(BRANCHES, url);
      const found = BRANCHES.find((entry) => entry.name === decodeURIComponent(branch));
      return found ? Response.json(found) : new Response("Not Found", { status: 404 });
    }
    return new Response("Not Found", { status: 404 });
  };
  return { fetch, calls, token: options.accessToken ?? TOKEN.access_token, user: USER };
}
