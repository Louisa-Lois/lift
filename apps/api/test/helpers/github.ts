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
        },
        author: { login: "ama-owusu" },
      });
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
