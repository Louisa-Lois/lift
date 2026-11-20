import {
  GITHUB_FILE_MAX_BYTES,
  GITHUB_TREE_MAX_FILES,
  type GithubBranch,
  type GithubFile,
  type GithubRepo,
  type GithubTree,
} from "@lift/shared";
import { problem } from "../lib/problem";

/** What the OAuth app asks for (docs/prd/01-backend-api.md, "Sign-in"). */
export const GITHUB_SCOPES = "read:user user:email repo admin:repo_hook";

const WEB = "https://github.com";
const API = "https://api.github.com";

/** The parts of `GET /user` Lift keeps. */
export interface GithubProfile {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
}

export interface GithubOptions {
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  /** Tests pass a fetch that answers from recorded responses. */
  fetch?: typeof globalThis.fetch | undefined;
}

export type Github = ReturnType<typeof createGithub>;

/** The parts of a repository GitHub returns that Lift uses. */
interface RawRepo {
  name: string;
  private: boolean;
  default_branch: string;
  pushed_at: string | null;
  owner: { login: string };
}

/** A commit as deployments record it. */
export interface GithubCommit {
  sha: string;
  /** The message's first line. */
  message: string | null;
  /** The author's GitHub login when GitHub knows it, otherwise their git name. */
  author: string | null;
}

interface RawCommit {
  sha: string;
  commit: { message: string; author: { name: string } | null };
  author: { login: string } | null;
}

function toCommit(raw: RawCommit): GithubCommit {
  const subject = raw.commit.message.split("\n", 1)[0]?.trim().slice(0, 500);
  return {
    sha: raw.sha,
    message: subject || null,
    author: raw.author?.login ?? raw.commit.author?.name ?? null,
  };
}

/** A repo file, or why Lift won't return it. */
export type GithubContents =
  | { kind: "file"; file: GithubFile }
  | { kind: "not_found" }
  | { kind: "folder" }
  | { kind: "binary" }
  | { kind: "too_large"; size: number };

interface RawTree {
  truncated: boolean;
  tree: { path: string; mode: string; type: string; sha: string; size?: number }[];
}

/** A symlink's mode in a git tree: GitHub lists it as a blob, whose content is its target. */
export const SYMLINK_MODE = "120000";

/** One file of a tree, with what the editor and its commits need. */
export interface GithubTreeFile {
  path: string;
  size: number;
  /** `100644`, `100755` (executable) or `120000` (a symlink). */
  mode: string;
  /** The blob's SHA, which is the git blob SHA of the file's bytes. */
  sha: string;
}

/** The files at a ref, with the commit it resolved to and that commit's tree. */
export interface GithubFiles {
  sha: string;
  treeSha: string;
  truncated: boolean;
  files: GithubTreeFile[];
}

interface RawContents {
  type: string;
  path: string;
  sha: string;
  size: number;
  encoding?: string;
  content?: string;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** The file's text, or null for anything that isn't UTF-8 text (a NUL byte, or invalid UTF-8). */
function textOf(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null;
  try {
    return utf8.decode(bytes);
  } catch {
    return null;
  }
}

function toRepo(raw: RawRepo): GithubRepo {
  return {
    owner: raw.owner.login,
    name: raw.name,
    private: raw.private,
    defaultBranch: raw.default_branch,
    pushedAt: raw.pushed_at,
  };
}

const hasNextPage = (response: Response) => /rel="next"/.test(response.headers.get("link") ?? "");
const segment = (value: string) => encodeURIComponent(value);
/** A repo path in a URL: each segment encoded, the slashes kept. */
const pathSegments = (path: string) => path.split("/").map(segment).join("/");
/** At most this many pages of 100 for lists Lift reads whole (branches, repo search). */
export const GITHUB_MAX_PAGES = 5;

/**
 * GitHub's OAuth endpoints and REST API. Errors become `github_error` (502) problems whose detail
 * names the call, never a token.
 */
export function createGithub(options: GithubOptions) {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const { clientId, clientSecret } = options;

  async function send(what: string, url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchFn(url, init);
    } catch (error) {
      throw problem("github_error", `GitHub didn't answer ${what}.`, { cause: error });
    }
  }

  function failure(what: string, response: Response) {
    if (response.status === 401) {
      return problem(
        "github_error",
        "GitHub refused the token Lift holds for you. Sign out and sign in again.",
      );
    }
    return problem("github_error", `GitHub answered ${response.status} to ${what}.`);
  }

  async function call(what: string, url: string, init: RequestInit): Promise<Response> {
    const response = await send(what, url, init);
    if (!response.ok) throw failure(what, response);
    return response;
  }

  /** Like `call`, but a 404 (no such repo, or no access to it) returns null. */
  async function callOrNull(
    what: string,
    url: string,
    init: RequestInit,
  ): Promise<Response | null> {
    const response = await send(what, url, init);
    if (response.status === 404) return null;
    if (!response.ok) throw failure(what, response);
    return response;
  }

  function api(token: string) {
    return {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "Lift",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    };
  }

  async function getRepo(token: string, owner: string, name: string): Promise<GithubRepo | null> {
    const response = await callOrNull(
      `GET /repos/${owner}/${name}`,
      `${API}/repos/${segment(owner)}/${segment(name)}`,
      api(token),
    );
    return response ? toRepo((await response.json()) as RawRepo) : null;
  }

  async function getFiles(
    token: string,
    owner: string,
    name: string,
    ref: string | undefined,
  ): Promise<GithubFiles | null> {
    const wanted = ref ?? (await getRepo(token, owner, name))?.defaultBranch;
    if (!wanted) return null;
    const what = `GET /repos/${owner}/${name}/commits/${wanted}`;
    const commitResponse = await send(
      what,
      `${API}/repos/${segment(owner)}/${segment(name)}/commits/${segment(wanted)}`,
      api(token),
    );
    if (commitResponse.status === 404 || commitResponse.status === 422) return null;
    if (!commitResponse.ok) throw failure(what, commitResponse);
    const commit = (await commitResponse.json()) as {
      sha: string;
      commit: { tree: { sha: string } };
    };
    const treeSha = commit.commit.tree.sha;
    const treeResponse = await callOrNull(
      `GET /repos/${owner}/${name}/git/trees/${treeSha}`,
      `${API}/repos/${segment(owner)}/${segment(name)}/git/trees/${treeSha}?recursive=1`,
      api(token),
    );
    if (!treeResponse) return null;
    const raw = (await treeResponse.json()) as RawTree;
    const blobs = raw.tree.filter((entry) => entry.type === "blob" && entry.path.length <= 1024);
    return {
      sha: commit.sha,
      treeSha,
      truncated: raw.truncated || blobs.length > GITHUB_TREE_MAX_FILES,
      files: blobs.slice(0, GITHUB_TREE_MAX_FILES).map((entry) => ({
        path: entry.path,
        size: entry.size ?? 0,
        mode: entry.mode,
        sha: entry.sha,
      })),
    };
  }

  function requireOAuth(): { clientId: string; clientSecret: string } {
    if (!clientId || !clientSecret) {
      throw problem("upstream_unavailable", "GitHub sign-in isn't configured on this server.");
    }
    return { clientId, clientSecret };
  }

  return {
    /** Whether GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are set. */
    configured: Boolean(clientId && clientSecret),

    /** Where `/auth/github/start` sends the browser. */
    authorizeUrl(redirectUri: string, state: string): string {
      const params = new URLSearchParams({
        client_id: requireOAuth().clientId,
        redirect_uri: redirectUri,
        scope: GITHUB_SCOPES,
        state,
        allow_signup: "false",
      });
      return `${WEB}/login/oauth/authorize?${params}`;
    },

    /** Trades the callback's `code` for an access token. */
    async exchangeCode(code: string, redirectUri: string): Promise<string> {
      const oauth = requireOAuth();
      const response = await call("the sign-in code exchange", `${WEB}/login/oauth/access_token`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: oauth.clientId,
          client_secret: oauth.clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });
      const body = (await response.json()) as { access_token?: string; error?: string };
      if (!body.access_token) {
        throw problem(
          "github_error",
          `GitHub refused the sign-in code (${body.error ?? "no token"}).`,
        );
      }
      return body.access_token;
    },

    async getProfile(token: string): Promise<GithubProfile> {
      const response = await call("GET /user", `${API}/user`, api(token));
      const body = (await response.json()) as GithubProfile;
      return {
        id: body.id,
        login: body.login,
        name: body.name ?? null,
        avatar_url: body.avatar_url,
      };
    },

    /** The primary email if GitHub has verified it, otherwise null. */
    async getPrimaryEmail(token: string): Promise<string | null> {
      const response = await call("GET /user/emails", `${API}/user/emails`, api(token));
      const emails = (await response.json()) as {
        email: string;
        primary: boolean;
        verified: boolean;
      }[];
      return emails.find((entry) => entry.primary && entry.verified)?.email ?? null;
    },

    /**
     * Revokes the whole authorization, so Lift also disappears from the person's authorized
     * OAuth apps (used for logins that aren't invited).
     */
    async revokeGrant(token: string): Promise<void> {
      const oauth = requireOAuth();
      const basic = Buffer.from(`${oauth.clientId}:${oauth.clientSecret}`).toString("base64");
      await call(
        "the grant revocation",
        `${API}/applications/${encodeURIComponent(oauth.clientId)}/grant`,
        {
          method: "DELETE",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/json",
            "User-Agent": "Lift",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({ access_token: token }),
        },
      );
    },

    /**
     * One page of the repos the user owns, collaborates on or reaches through an organisation,
     * most recently pushed first.
     */
    async listRepos(
      token: string,
      page: number,
      perPage: number,
    ): Promise<{ repos: GithubRepo[]; hasNext: boolean }> {
      const params = new URLSearchParams({
        affiliation: "owner,collaborator,organization_member",
        sort: "pushed",
        direction: "desc",
        per_page: String(perPage),
        page: String(page),
      });
      const response = await call("GET /user/repos", `${API}/user/repos?${params}`, api(token));
      const body = (await response.json()) as RawRepo[];
      return { repos: body.map(toRepo), hasNext: hasNextPage(response) };
    },

    /** The repo if the user can read it, otherwise null. */
    getRepo,

    /** Every branch (up to 500), or null when the user can't read the repo. */
    async listBranches(token: string, owner: string, name: string): Promise<GithubBranch[] | null> {
      const branches: GithubBranch[] = [];
      for (let page = 1; page <= GITHUB_MAX_PAGES; page += 1) {
        const response = await callOrNull(
          `GET /repos/${owner}/${name}/branches`,
          `${API}/repos/${segment(owner)}/${segment(name)}/branches?per_page=100&page=${page}`,
          api(token),
        );
        if (!response) return null;
        const body = (await response.json()) as { name: string }[];
        branches.push(...body.map((branch) => ({ name: branch.name })));
        if (!hasNextPage(response)) break;
      }
      return branches;
    },

    async branchExists(
      token: string,
      owner: string,
      name: string,
      branch: string,
    ): Promise<boolean> {
      const response = await callOrNull(
        `GET /repos/${owner}/${name}/branches/${branch}`,
        `${API}/repos/${segment(owner)}/${segment(name)}/branches/${segment(branch)}`,
        api(token),
      );
      return response !== null;
    },

    /**
     * Adds a push webhook to a repo (BE-08); null when the user may not (GitHub answers 403 or 404
     * without admin rights on the repo).
     */
    async createHook(
      token: string,
      owner: string,
      name: string,
      hook: { url: string; secret: string },
    ): Promise<number | null> {
      const what = `POST /repos/${owner}/${name}/hooks`;
      const response = await send(what, `${API}/repos/${segment(owner)}/${segment(name)}/hooks`, {
        method: "POST",
        headers: { ...api(token).headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "web",
          active: true,
          events: ["push"],
          config: { url: hook.url, content_type: "json", secret: hook.secret, insecure_ssl: "0" },
        }),
      });
      if (response.status === 403 || response.status === 404) return null;
      if (!response.ok) throw failure(what, response);
      return ((await response.json()) as { id: number }).id;
    },

    /** Removes a webhook; one already gone, or one the user may not remove, is left alone. */
    async deleteHook(token: string, owner: string, name: string, hookId: number): Promise<void> {
      const what = `DELETE /repos/${owner}/${name}/hooks/${hookId}`;
      const response = await send(
        what,
        `${API}/repos/${segment(owner)}/${segment(name)}/hooks/${hookId}`,
        { method: "DELETE", ...api(token) },
      );
      if (response.ok || response.status === 403 || response.status === 404) return;
      throw failure(what, response);
    },

    /**
     * A commit by branch name or SHA, or null when the repo or the ref doesn't exist or the user
     * can't read it (GitHub answers 422 for an unknown SHA).
     */
    async getCommit(
      token: string,
      owner: string,
      name: string,
      ref: string,
    ): Promise<GithubCommit | null> {
      const what = `GET /repos/${owner}/${name}/commits/${ref}`;
      const response = await send(
        what,
        `${API}/repos/${segment(owner)}/${segment(name)}/commits/${segment(ref)}`,
        api(token),
      );
      if (response.status === 404 || response.status === 422) return null;
      if (!response.ok) throw failure(what, response);
      return toCommit((await response.json()) as RawCommit);
    },

    /**
     * The files at a branch, tag or commit (the default branch without `ref`): paths and sizes,
     * at most 5,000, with the commit the ref resolved to. Null when the repo or the ref doesn't
     * exist or the user can't read it. Folders and submodules aren't listed.
     */
    async getTree(
      token: string,
      owner: string,
      name: string,
      ref: string | undefined,
    ): Promise<GithubTree | null> {
      const tree = await getFiles(token, owner, name, ref);
      if (!tree) return null;
      return {
        sha: tree.sha,
        truncated: tree.truncated,
        files: tree.files.map((file) => ({ path: file.path, size: file.size })),
      };
    },
    /** Like `getTree`, with each file's mode and blob SHA, and the commit's tree SHA. */
    getFiles,
    /** One text file at a branch, tag or commit (the default branch without `ref`), up to 1 MB. */
    async getContents(
      token: string,
      owner: string,
      name: string,
      path: string,
      ref: string | undefined,
    ): Promise<GithubContents> {
      const query = ref ? `?ref=${segment(ref)}` : "";
      const response = await callOrNull(
        `GET /repos/${owner}/${name}/contents/${path}`,
        `${API}/repos/${segment(owner)}/${segment(name)}/contents/${pathSegments(path)}${query}`,
        api(token),
      );
      if (!response) return { kind: "not_found" };
      const raw = (await response.json()) as RawContents | unknown[];
      if (Array.isArray(raw) || raw.type === "dir") return { kind: "folder" };
      if (raw.type !== "file") return { kind: "not_found" };
      if (raw.size > GITHUB_FILE_MAX_BYTES || raw.encoding !== "base64") {
        return { kind: "too_large", size: raw.size };
      }
      const content = textOf(Buffer.from(raw.content ?? "", "base64"));
      if (content === null) return { kind: "binary" };
      return { kind: "file", file: { path: raw.path, sha: raw.sha, size: raw.size, content } };
    },
    /**
     * BE-18: a commit of these files on top of `parent`, with the Git Data API: a blob each, a
     * tree on the parent's, then the commit. Made with the user's token, so the commit is theirs.
     * The branch doesn't move: see `fastForward`. A user who can't push gets `forbidden`.
     */
    async writeCommit(
      token: string,
      owner: string,
      name: string,
      input: {
        parent: string;
        baseTree: string;
        message: string;
        files: { path: string; mode: string; content: string }[];
      },
    ): Promise<{ sha: string; blobs: Record<string, string> }> {
      const repo = `${segment(owner)}/${segment(name)}`;
      async function post<T>(what: string, path: string, body: unknown): Promise<T> {
        const response = await send(what, `${API}/repos/${repo}/${path}`, {
          method: "POST",
          headers: { ...api(token).headers, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        // GitHub answers 403 or 404 to a user who can read the repo but not push to it.
        if (response.status === 403 || response.status === 404) {
          throw problem(
            "forbidden",
            `Your GitHub account can't push to ${owner}/${name}. Ask for write access, or let someone who has it commit.`,
          );
        }
        if (!response.ok) throw failure(what, response);
        return (await response.json()) as T;
      }
      const blobs: Record<string, string> = {};
      for (const file of input.files) {
        const blob = await post<{ sha: string }>(
          `POST /repos/${owner}/${name}/git/blobs`,
          "git/blobs",
          { content: file.content, encoding: "utf-8" },
        );
        blobs[file.path] = blob.sha;
      }
      const tree = await post<{ sha: string }>(
        `POST /repos/${owner}/${name}/git/trees`,
        "git/trees",
        {
          base_tree: input.baseTree,
          tree: input.files.map((file) => ({
            path: file.path,
            mode: file.mode,
            type: "blob",
            sha: blobs[file.path],
          })),
        },
      );
      const commit = await post<{ sha: string }>(
        `POST /repos/${owner}/${name}/git/commits`,
        "git/commits",
        { message: input.message, tree: tree.sha, parents: [input.parent] },
      );
      return { sha: commit.sha, blobs };
    },
    /**
     * Moves a branch to a commit that has its head as parent, never forcing. False when GitHub
     * refuses (422): someone pushed meanwhile, or the branch is protected.
     */
    async fastForward(
      token: string,
      owner: string,
      name: string,
      branch: string,
      sha: string,
    ): Promise<boolean> {
      const what = `PATCH /repos/${owner}/${name}/git/refs/heads/${branch}`;
      const response = await send(
        what,
        `${API}/repos/${segment(owner)}/${segment(name)}/git/refs/heads/${pathSegments(branch)}`,
        {
          method: "PATCH",
          headers: { ...api(token).headers, "Content-Type": "application/json" },
          body: JSON.stringify({ sha, force: false }),
        },
      );
      if (response.status === 422 || response.status === 409) return false;
      if (!response.ok) throw failure(what, response);
      return true;
    },
  };
}
