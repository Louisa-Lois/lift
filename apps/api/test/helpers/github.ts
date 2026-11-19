import { readFileSync } from "node:fs";

// GitHub is mocked with recorded responses (docs/prd/01-backend-api.md, "Testing"): the shapes
// of real answers, trimmed, for a fictional user.
const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/github/${name}.json`, import.meta.url), "utf8"));
const TOKEN = fixture("token") as { access_token: string };
const USER = fixture("user") as Record<string, unknown>;
const EMAILS = fixture("emails") as unknown[];

export interface RecordedCall {
  method: string;
  url: URL;
  headers: Headers;
  body: string;
}

/**
 * A fetch that answers like GitHub and records every call, so tests can check what the API sent
 * (and that tokens only ever go to GitHub).
 */
export function fakeGithub(options: { login?: string; failTokenExchange?: boolean } = {}) {
  const calls: RecordedCall[] = [];
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
      return Response.json(options.login ? { ...USER, login: options.login } : USER);
    }
    if (route === "GET api.github.com/user/emails") return Response.json(EMAILS);
    if (request.method === "DELETE" && url.pathname.startsWith("/applications/")) {
      return new Response(null, { status: 204 });
    }
    return new Response("Not Found", { status: 404 });
  };
  return { fetch, calls, token: TOKEN.access_token, user: USER };
}
