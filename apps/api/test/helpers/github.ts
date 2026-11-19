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
const blobSha = (path: string) => Buffer.from(path).toString("hex").padEnd(40, "0").slice(0, 40);

/**
 * Each repo's tree, as `git/trees/{sha}?recursive=1` answers: next-hello has the files above
 * (with their folders and a submodule, which aren't files); express-postgres has 6,000 files;
 * notes is one GitHub itself truncated.
 */
function treeOf(repo: string) {
  if (repo === "express-postgres") {
    return {
      truncated: false,
      tree: Array.from({ length: 6_000 }, (_, i) => ({
        path: `src/file-${String(i).padStart(4, "0")}.ts`,
        type: "blob",
        size: 10,
      })),
    };
  }
  if (repo === "notes") {
    return { truncated: true, tree: [{ path: "notes.md", type: "blob", size: 5 }] };
  }
  return {
    truncated: false,
    tree: [
      { path: "README.md", type: "blob", size: bytesOf(REPO_FILES["README.md"] ?? "").length },
      { path: "app", type: "tree" },
      {
        path: "app/page.tsx",
        type: "blob",
        size: bytesOf(REPO_FILES["app/page.tsx"] ?? "").length,
      },
      { path: "data", type: "tree" },
      { path: BIG_FILE.path, type: "blob", size: BIG_FILE.size },
      {
        path: "package.json",
        type: "blob",
        size: bytesOf(REPO_FILES["package.json"] ?? "").length,
      },
      { path: "public", type: "tree" },
      { path: "public/logo.png", type: "blob", size: 12 },
      { path: "vendor/ui", type: "commit" },
    ],
  };
}

/** `contents/{path}`: a file (base64 in 60-character lines, like GitHub), a folder, or 404. */
function contentsOf(path: string): Response {
  if (path === BIG_FILE.path) {
    return Response.json({
      type: "file",
      path,
      sha: blobSha(path),
      size: BIG_FILE.size,
      encoding: "none",
      content: "",
    });
  }
  const content = REPO_FILES[path];
  if (content !== undefined) {
    const bytes = bytesOf(content);
    return Response.json({
      type: "file",
      path,
      sha: blobSha(path),
      size: bytes.length,
      encoding: "base64",
      content: `${bytes.toString("base64").replace(/.{60}/g, "$&\n")}\n`,
    });
  }
  const children = Object.keys(REPO_FILES).filter((file) => file.startsWith(`${path}/`));
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
      return options.failTokenExchange
        ? new Response("Service Unavailable", { status: 503 })
        : Response.json(TOKEN);
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
      return Response.json({ sha, ...treeOf(decodeURIComponent(name)) });
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
      return contentsOf(path.split("/").map(decodeURIComponent).join("/"));
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
  return { fetch, calls, token: TOKEN.access_token, user: USER };
}
