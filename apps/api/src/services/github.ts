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

/**
 * GitHub's OAuth endpoints and REST API. Errors become `github_error` (502) problems whose detail
 * names the call, never a token.
 */
export function createGithub(options: GithubOptions) {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const { clientId, clientSecret } = options;

  async function call(what: string, url: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await fetchFn(url, init);
    } catch (error) {
      throw problem("github_error", `GitHub didn't answer ${what}.`, { cause: error });
    }
    if (!response.ok) {
      throw problem("github_error", `GitHub answered ${response.status} to ${what}.`);
    }
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
  };
}
