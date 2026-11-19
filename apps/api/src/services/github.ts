import type { GithubBranch, GithubRepo } from "@lift/shared";
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
    async getRepo(token: string, owner: string, name: string): Promise<GithubRepo | null> {
      const response = await callOrNull(
        `GET /repos/${owner}/${name}`,
        `${API}/repos/${segment(owner)}/${segment(name)}`,
        api(token),
      );
      return response ? toRepo((await response.json()) as RawRepo) : null;
    },

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
  };
}
