import { describe, expect, it, vi } from "vitest";
import {
  createLiftClient,
  LiftApiError,
  type LiftClient,
  LiftContractError,
  PROBLEM_CONTENT_TYPE,
  readSse,
} from "../src";
import * as fx from "../src/fixtures";

const BASE = "http://localhost:4000/api/v1";
const TOKEN = `lift_pat_${"a".repeat(32)}`;

type Call = { url: string; method: string; headers: Headers; body: unknown };

/** A fetch that answers with the given responses in order and records every request. */
function mockFetch(...responses: Response[]) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
    });
    const response = responses.shift();
    if (!response) throw new Error(`unexpected request to ${String(input)}`);
    return response;
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const json = (status: number, body: unknown, contentType = "application/json") =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": contentType } });

const noContent = () => new Response(null, { status: 204 });

const problem = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  json(
    status,
    { type: "about:blank", title: "Request failed", status, detail: `It ${code}`, code, ...extra },
    PROBLEM_CONTENT_TYPE,
  );

function sse(chunks: string[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const web = fx.services.web;
const activeId = web.activeDeploymentId ?? "";
const activeDetail = fx.deploymentDetails[activeId];
const sha = "0123456789abcdef0123456789abcdef01234567";

type Case = {
  name: string;
  call: (client: LiftClient) => Promise<unknown>;
  method: string;
  path: string;
  body?: unknown;
  response: () => Response;
  returns: unknown;
};

const cases: Case[] = [
  {
    name: "health",
    call: (c) => c.health(),
    method: "GET",
    path: "/health",
    response: () => json(200, { status: "ok" }),
    returns: { status: "ok" },
  },
  {
    name: "me",
    call: (c) => c.me(),
    method: "GET",
    path: "/me",
    response: () => json(200, fx.me),
    returns: fx.me,
  },
  {
    name: "logout",
    call: (c) => c.logout(),
    method: "POST",
    path: "/auth/logout",
    response: noContent,
    returns: undefined,
  },
  {
    name: "github.repos",
    call: (c) => c.github.repos({ query: "next", limit: 20 }),
    method: "GET",
    path: "/github/repos?query=next&limit=20",
    response: () => json(200, fx.page(fx.githubRepos)),
    returns: fx.page(fx.githubRepos),
  },
  {
    name: "github.branches",
    call: (c) => c.github.branches("lift-demo", "next-hello"),
    method: "GET",
    path: "/github/repos/lift-demo/next-hello/branches",
    response: () => json(200, fx.page(fx.githubBranches["lift-demo/next-hello"] ?? [])),
    returns: fx.page(fx.githubBranches["lift-demo/next-hello"] ?? []),
  },
  {
    name: "projects.list",
    call: (c) => c.projects.list({ limit: 10, cursor: "c2" }),
    method: "GET",
    path: "/projects?limit=10&cursor=c2",
    response: () => json(200, fx.page([fx.projectListItem])),
    returns: fx.page([fx.projectListItem]),
  },
  {
    name: "projects.create",
    call: (c) => c.projects.create({ name: "Demo shop" }),
    method: "POST",
    path: "/projects",
    body: { name: "Demo shop" },
    response: () => json(201, fx.project),
    returns: fx.project,
  },
  {
    name: "projects.get",
    call: (c) => c.projects.get(fx.project.id),
    method: "GET",
    path: `/projects/${fx.project.id}`,
    response: () => json(200, fx.project),
    returns: fx.project,
  },
  {
    name: "projects.update",
    call: (c) => c.projects.update(fx.project.id, { name: "Shop" }),
    method: "PATCH",
    path: `/projects/${fx.project.id}`,
    body: { name: "Shop" },
    response: () => json(200, { ...fx.project, name: "Shop" }),
    returns: { ...fx.project, name: "Shop" },
  },
  {
    name: "projects.delete",
    call: (c) => c.projects.delete(fx.project.id),
    method: "DELETE",
    path: `/projects/${fx.project.id}`,
    response: noContent,
    returns: undefined,
  },
  {
    name: "services.list",
    call: (c) => c.services.list(fx.project.id),
    method: "GET",
    path: `/projects/${fx.project.id}/services`,
    response: () => json(200, fx.page(Object.values(fx.services))),
    returns: fx.page(Object.values(fx.services)),
  },
  {
    name: "services.create",
    call: (c) =>
      c.services.create(fx.project.id, {
        name: "web",
        repo: { owner: "lift-demo", name: "next-hello" },
        branch: "main",
        deploy: true,
      }),
    method: "POST",
    path: `/projects/${fx.project.id}/services`,
    body: {
      name: "web",
      repo: { owner: "lift-demo", name: "next-hello" },
      branch: "main",
      deploy: true,
    },
    response: () => json(201, web),
    returns: web,
  },
  {
    name: "services.get",
    call: (c) => c.services.get(web.id),
    method: "GET",
    path: `/services/${web.id}`,
    response: () => json(200, web),
    returns: web,
  },
  {
    name: "services.update",
    call: (c) => c.services.update(web.id, { port: 8080 }),
    method: "PATCH",
    path: `/services/${web.id}`,
    body: { port: 8080 },
    response: () => json(200, { ...web, port: 8080 }),
    returns: { ...web, port: 8080 },
  },
  {
    name: "services.delete",
    call: (c) => c.services.delete(web.id),
    method: "DELETE",
    path: `/services/${web.id}`,
    response: noContent,
    returns: undefined,
  },
  {
    name: "deployments.list",
    call: (c) => c.deployments.list(web.id, { limit: 5 }),
    method: "GET",
    path: `/services/${web.id}/deployments?limit=5`,
    response: () => json(200, fx.page(fx.deployments.web)),
    returns: fx.page(fx.deployments.web),
  },
  {
    name: "deployments.create",
    call: (c) => c.deployments.create(web.id, { commitSha: sha }),
    method: "POST",
    path: `/services/${web.id}/deployments`,
    body: { commitSha: sha },
    response: () => json(202, fx.deployments.web[0]),
    returns: fx.deployments.web[0],
  },
  {
    name: "deployments.create without a commit",
    call: (c) => c.deployments.create(web.id),
    method: "POST",
    path: `/services/${web.id}/deployments`,
    body: {},
    response: () => json(202, fx.deployments.web[0]),
    returns: fx.deployments.web[0],
  },
  {
    name: "deployments.get",
    call: (c) => c.deployments.get(activeId),
    method: "GET",
    path: `/deployments/${activeId}`,
    response: () => json(200, activeDetail),
    returns: activeDetail,
  },
  {
    name: "deployments.logs",
    call: (c) => c.deployments.logs(activeId, { tail: 200 }),
    method: "GET",
    path: `/deployments/${activeId}/logs?tail=200`,
    response: () => json(200, { data: fx.buildLog }),
    returns: { data: fx.buildLog },
  },
];

describe("requests", () => {
  it.each(cases)("$name sends $method $path", async (c) => {
    const { fetch, calls } = mockFetch(c.response());
    const client = createLiftClient({ baseUrl: BASE, token: TOKEN, fetch });

    await expect(c.call(client)).resolves.toEqual(c.returns);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: c.method, url: `${BASE}${c.path}`, body: c.body });
  });

  it("sends the bearer token and asks for JSON", async () => {
    const { fetch, calls } = mockFetch(json(201, fx.project));
    await createLiftClient({ baseUrl: BASE, token: TOKEN, fetch }).projects.create({ name: "x" });

    const headers = calls[0]?.headers;
    expect(headers?.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers?.get("accept")).toBe("application/json");
    expect(headers?.get("content-type")).toBe("application/json");
  });

  it("sends no Authorization header without a token, so the browser's cookie is used", async () => {
    const { fetch, calls } = mockFetch(json(200, fx.me));
    await createLiftClient({ baseUrl: "/api/v1", fetch }).me();

    expect(calls[0]?.url).toBe("/api/v1/me");
    expect(calls[0]?.headers.has("authorization")).toBe(false);
    expect(calls[0]?.headers.has("content-type")).toBe(false);
  });

  it("encodes path segments and drops a trailing slash from the base URL", async () => {
    const { fetch, calls } = mockFetch(json(200, fx.page([])));
    await createLiftClient({ baseUrl: `${BASE}/`, fetch }).github.branches("lift demo", "a/b");

    expect(calls[0]?.url).toBe(`${BASE}/github/repos/lift%20demo/a%2Fb/branches`);
  });

  it("leaves out query parameters that aren't set", async () => {
    const { fetch, calls } = mockFetch(json(200, fx.page([])));
    await createLiftClient({ baseUrl: BASE, fetch }).projects.list({ cursor: undefined });

    expect(calls[0]?.url).toBe(`${BASE}/projects`);
  });

  it("builds URLs for EventSource and the sign-in redirect", () => {
    const { urls } = createLiftClient({ baseUrl: "/api/v1" });
    expect(urls.githubSignIn("/p/x?tab=logs")).toBe(
      "/api/v1/auth/github/start?next=%2Fp%2Fx%3Ftab%3Dlogs",
    );
    expect(urls.githubSignIn()).toBe("/api/v1/auth/github/start");
    expect(urls.deploymentLogStream(activeId)).toBe(`/api/v1/deployments/${activeId}/logs/stream`);
    expect(urls.projectEventStream(fx.project.id)).toBe(
      `/api/v1/projects/${fx.project.id}/events/stream`,
    );
  });
});

describe("errors", () => {
  it("turns problem+json into a LiftApiError with the stable code", async () => {
    const { fetch } = mockFetch(problem(403, "forbidden"));
    const error = await createLiftClient({ baseUrl: BASE, fetch })
      .services.delete(web.id)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LiftApiError);
    expect(error).toMatchObject({
      status: 403,
      code: "forbidden",
      title: "Request failed",
      detail: "It forbidden",
      message: "It forbidden",
    });
  });

  it("keeps field errors so forms can show them", async () => {
    const fields = { "repo.owner": "Required", port: "Must be between 1 and 65535" };
    const { fetch } = mockFetch(problem(400, "validation_failed", { fields }));
    const error = await createLiftClient({ baseUrl: BASE, fetch })
      .services.update(web.id, { port: 0 })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ code: "validation_failed", fields });
  });

  it.each([
    [502, "upstream_unavailable"],
    [503, "upstream_unavailable"],
    [500, "internal"],
    [401, "unauthenticated"],
    [404, "not_found"],
    [429, "rate_limited"],
  ])("maps a %i without a problem body to %s", async (status, code) => {
    const html = new Response("<html>Bad gateway</html>", {
      status,
      headers: { "content-type": "text/html" },
    });
    const { fetch } = mockFetch(html);
    const error = await createLiftClient({ baseUrl: BASE, fetch })
      .me()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LiftApiError);
    expect(error).toMatchObject({ status, code });
  });

  it("treats a problem body with an unknown code as internal", async () => {
    const { fetch } = mockFetch(problem(418, "teapot"));
    const error = await createLiftClient({ baseUrl: BASE, fetch })
      .me()
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 418, code: "internal" });
  });

  it("throws LiftContractError when a success body doesn't match the schema", async () => {
    const { fetch } = mockFetch(json(200, { ...fx.me, id: "not-an-id" }));
    const error = await createLiftClient({ baseUrl: BASE, fetch })
      .me()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LiftContractError);
    expect(error).toMatchObject({ method: "GET", path: "/me", status: 200 });
  });

  it("lets network failures through unchanged", async () => {
    const failure = new TypeError("fetch failed");
    const fetch = vi.fn(async () => {
      throw failure;
    }) as unknown as typeof globalThis.fetch;

    await expect(createLiftClient({ baseUrl: BASE, fetch }).me()).rejects.toBe(failure);
  });
});

describe("streams", () => {
  const line = (n: number) => fx.buildLog[n];

  it("yields typed log lines and the end event, across chunk boundaries", async () => {
    const first = line(0);
    const second = line(1);
    const body = [
      `id: ${first?.id}\nevent: log\ndata: ${JSON.stringify({ ts: first?.ts, stream: first?.stream, line: first?.line })}\n\n`,
      ": heartbeat\n\n",
      `id: ${second?.id}\nevent: log\nda`,
      `ta: ${JSON.stringify({ ts: second?.ts, stream: second?.stream, line: second?.line })}\n\n`,
      `id: ${second?.id}\nevent: end\ndata: {"status":"active"}\n\n`,
    ];
    const { fetch, calls } = mockFetch(sse(body));
    const client = createLiftClient({ baseUrl: BASE, token: TOKEN, fetch });

    const events = [];
    for await (const event of client.deployments.streamLogs(activeId, { lastEventId: "1-0" })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        id: first?.id,
        event: "log",
        data: { ts: first?.ts, stream: first?.stream, line: first?.line },
      },
      {
        id: second?.id,
        event: "log",
        data: { ts: second?.ts, stream: second?.stream, line: second?.line },
      },
      { id: second?.id, event: "end", data: { status: "active" } },
    ]);
    expect(calls[0]?.url).toBe(`${BASE}/deployments/${activeId}/logs/stream`);
    expect(calls[0]?.headers.get("accept")).toBe("text/event-stream");
    expect(calls[0]?.headers.get("last-event-id")).toBe("1-0");
    expect(calls[0]?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("yields project events and skips types this client doesn't know", async () => {
    const [newest, older] = fx.events;
    const unknown = { ...newest, type: "agent.incident", data: { note: "from the future" } };
    const body = [
      `id: 3-0\nevent: ${newest?.type}\ndata: ${JSON.stringify(newest)}\n\n`,
      `id: 4-0\nevent: agent.incident\ndata: ${JSON.stringify(unknown)}\n\n`,
      `id: 5-0\nevent: ${older?.type}\ndata: ${JSON.stringify(older)}\n\n`,
    ];
    const { fetch } = mockFetch(sse(body));
    const client = createLiftClient({ baseUrl: BASE, fetch });

    const events = [];
    for await (const event of client.projects.streamEvents(fx.project.id)) events.push(event);

    expect(events).toEqual([
      { id: "3-0", event: newest?.type, data: newest },
      { id: "5-0", event: older?.type, data: older },
    ]);
  });

  it("throws LiftContractError when a known event carries the wrong payload", async () => {
    const broken = { ...fx.events[0], data: { nope: true } };
    const { fetch } = mockFetch(sse([`id: 1-0\nevent: x\ndata: ${JSON.stringify(broken)}\n\n`]));
    const stream = createLiftClient({ baseUrl: BASE, fetch }).projects.streamEvents(fx.project.id);

    await expect(stream.next()).rejects.toBeInstanceOf(LiftContractError);
  });

  it("throws LiftApiError when the stream can't open", async () => {
    const { fetch } = mockFetch(problem(404, "not_found"));
    const stream = createLiftClient({ baseUrl: BASE, fetch }).deployments.streamLogs(activeId);

    await expect(stream.next()).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("parses CRLF line endings, multi-line data and a remembered id", async () => {
    const body = sse([
      "id: 7-1\r\nevent: a\r\ndata: one\r\ndata: two\r\n\r\n",
      "event: b\ndata: x\n\n",
    ]).body;
    const messages = [];
    if (body) for await (const message of readSse(body)) messages.push(message);

    expect(messages).toEqual([
      { id: "7-1", event: "a", data: "one\ntwo" },
      { id: "7-1", event: "b", data: "x" },
    ]);
  });
});
