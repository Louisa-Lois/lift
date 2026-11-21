import { API_BASE_PATH } from "@lift/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server";
import { browserOf } from "../src/services/csp-reports";
import { testEnv } from "./helpers/env";

const REPORTS = `${API_BASE_PATH}/csp-reports`;
const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const FIREFOX =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0";
const SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const EDGE = `${CHROME} Edg/142.0.0.0`;

const PROJECT = "prj_0123456789abcdefghijklmn";
const NONCE = "bm9uY2UtdGhhdC1zdGF5cw==";
const POLICY = `script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'; report-uri ${REPORTS}`;

/** What Firefox and Safari send (report-uri): an inline script the policy would block. */
const legacy = (overrides: Record<string, unknown> = {}) => ({
  "csp-report": {
    "document-uri": `https://app.trylift.dev/p/${PROJECT}?tab=logs&code=oauth_code_value#fragment_value`,
    referrer: "https://github.com/login?return_to=referrer_value",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "original-policy": POLICY,
    disposition: "report",
    "blocked-uri": "inline",
    "line-number": 12,
    "column-number": 34,
    "source-file": "https://app.trylift.dev/_next/static/chunks/app.js?v=source_query_value",
    "status-code": 200,
    "script-sample": 'self.__next_f.push([1,"sample_value"])',
    ...overrides,
  },
});

/** What Chrome and Edge send (report-to): a batch, which can hold other kinds of report. */
const chromeReport = (body: Record<string, unknown>, type = "csp-violation") => ({
  type,
  age: 10,
  url: "https://app.trylift.dev/projects",
  user_agent: CHROME,
  body: { disposition: "report", originalPolicy: POLICY, referrer: "", statusCode: 200, ...body },
});

const servers: ReturnType<typeof buildServer>[] = [];

/** A server of its own (the counts are per server), and what it logged about reports. */
function reportServer() {
  const lines: string[] = [];
  const app = buildServer(testEnv({ LOG_LEVEL: "warn" }), {
    logStream: { write: (line) => void lines.push(line) },
  });
  servers.push(app);
  const send = (body: unknown, contentType = "application/csp-report", userAgent = CHROME) =>
    app.inject({
      method: "POST",
      url: REPORTS,
      headers: { "content-type": contentType, "user-agent": userAgent },
      payload: typeof body === "string" ? body : JSON.stringify(body),
    });
  const logged = () =>
    lines
      .map((line) => JSON.parse(line) as { level: number; msg: string; csp?: unknown })
      .filter((entry) => entry.msg.startsWith("csp"));
  return { app, send, logged, raw: () => lines.join("\n") };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((app) => app.close()));
});

describe("CSP violation reports", () => {
  it("logs a report-uri report as one line, with only what helps fix the policy", async () => {
    const { send, logged, raw } = reportServer();
    const response = await send(legacy(), "application/csp-report", FIREFOX);
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(logged()).toEqual([
      expect.objectContaining({
        level: 40,
        msg: "csp violation",
        csp: {
          directive: "script-src-elem",
          blocked: "inline",
          page: "/p/prj_*",
          source: "/_next/static/chunks/app.js",
          line: 12,
          column: 34,
          disposition: "report",
          browser: "Firefox 145",
        },
      }),
    ]);
    // Queries and fragments can hold codes and tokens, the sample page data, the policy its nonce.
    for (const kept of [
      "oauth_code_value",
      "fragment_value",
      "source_query_value",
      "referrer_value",
      "sample_value",
      NONCE,
      PROJECT,
      "Mozilla",
    ]) {
      expect(raw()).not.toContain(kept);
    }
  });

  it("logs a Reporting API batch, one line for each violation, and skips other reports", async () => {
    const { send, logged, raw } = reportServer();
    const response = await send(
      [
        chromeReport({
          documentURL: "https://app.trylift.dev/projects?cursor=abc",
          effectiveDirective: "script-src",
          blockedURL: "eval",
          sourceFile: "https://app.trylift.dev/_next/static/chunks/zod.js",
          lineNumber: 1,
          columnNumber: 2,
          sample: 'new Function("sample_value")',
        }),
        chromeReport({
          documentURL: "https://app.trylift.dev/login",
          effectiveDirective: "img-src",
          blockedURL: "https://images.example.com/hero.png?signature=signed_value",
        }),
        chromeReport({ id: "UnloadHandler", message: "Unload is deprecated." }, "deprecation"),
      ],
      "application/reports+json",
    );
    expect(response.statusCode).toBe(204);
    expect(logged().map((entry) => entry.csp)).toEqual([
      {
        directive: "script-src",
        blocked: "eval",
        page: "/projects",
        source: "/_next/static/chunks/zod.js",
        line: 1,
        column: 2,
        disposition: "report",
        browser: "Chrome 142",
      },
      {
        directive: "img-src",
        blocked: "https://images.example.com",
        page: "/login",
        disposition: "report",
        browser: "Chrome 142",
      },
    ]);
    for (const kept of ["signed_value", "hero.png", "sample_value", NONCE, "cursor"]) {
      expect(raw()).not.toContain(kept);
    }
  });

  it("logs a repeated violation once a minute", async () => {
    const { send, logged } = reportServer();
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    await send(legacy());
    await send(legacy());
    // Another project's page is the same violation.
    await send(
      legacy({ "document-uri": "https://app.trylift.dev/p/prj_zyxwvutsrqponmlkjihgfedc" }),
    );
    expect(logged()).toHaveLength(1);
    now.mockReturnValue(1_000_000 + 61_000);
    await send(legacy());
    expect(logged()).toHaveLength(2);
  });

  it("skips what browser extensions cause", async () => {
    const { send, logged } = reportServer();
    await send(legacy({ "blocked-uri": "chrome-extension://abcdef/inject.js" }));
    await send(legacy({ "source-file": "moz-extension://abcdef/content.js" }));
    await send(legacy({ "blocked-uri": "safari-web-extension://abcdef/script.js" }));
    expect(logged()).toEqual([]);
  });

  it("logs at most 50 different violations a minute, then says the rest were dropped", async () => {
    const { send, logged } = reportServer();
    const now = vi.spyOn(Date, "now").mockReturnValue(2_000_000);
    const many = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        chromeReport({
          documentURL: "https://app.trylift.dev/projects",
          effectiveDirective: "script-src",
          blockedURL: "inline",
          lineNumber: index + 1,
        }),
      );
    await send(many(52), "application/reports+json");
    await send(many(60), "application/reports+json");
    const messages = logged().map((entry) => entry.msg);
    expect(messages.filter((message) => message === "csp violation")).toHaveLength(50);
    expect(messages.filter((message) => message.startsWith("csp violations dropped"))).toHaveLength(
      1,
    );
    now.mockReturnValue(2_000_000 + 60_000);
    await send(many(1), "application/reports+json");
    expect(logged().at(-1)?.msg).toBe("csp violation");
  });

  it("answers 204 without a session, 413 to a body over 64 KB, 400 to one that isn't JSON", async () => {
    const { send } = reportServer();
    expect((await send(legacy(), "application/json")).statusCode).toBe(204);
    expect((await send({ unexpected: true })).statusCode).toBe(204);
    const huge = legacy({ "script-sample": "x".repeat(65 * 1024) });
    expect((await send(huge)).statusCode).toBe(413);
    expect((await send("{ not json", "application/csp-report")).statusCode).toBe(400);
  });

  it("isn't in the OpenAPI document: it's for browsers, not API clients", async () => {
    const { app } = reportServer();
    const spec = (await app.inject({ url: `${API_BASE_PATH}/openapi.json` })).json() as {
      paths: Record<string, unknown>;
    };
    expect(Object.keys(spec.paths).length).toBeGreaterThan(10);
    expect(Object.keys(spec.paths).filter((path) => path.includes("csp"))).toEqual([]);
  });

  it("names the browser and its major version, never more of the user agent", () => {
    expect(browserOf(CHROME)).toBe("Chrome 142");
    expect(browserOf(EDGE)).toBe("Edge 142");
    expect(browserOf(FIREFOX)).toBe("Firefox 145");
    expect(browserOf(SAFARI)).toBe("Safari 26");
    expect(browserOf("curl/8.7.1")).toBe("other");
    expect(browserOf(undefined)).toBe("other");
  });
});
