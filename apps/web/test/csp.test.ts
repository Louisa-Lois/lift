// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CSP_HEADER, contentSecurityPolicy } from "@/lib/csp";
import { config, proxy } from "@/proxy";

/** A policy's directives by name. */
function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split("; ").map((directive) => {
      const [name = "", ...values] = directive.split(" ");
      return [name, values];
    }),
  );
}

const production = directives(
  contentSecurityPolicy({
    nonce: "bm9uY2U=",
    development: false,
    collabUrl: "wss://app.trylift.dev/collab",
  }),
);
const development = directives(
  contentSecurityPolicy({ nonce: "bm9uY2U=", development: true, collabUrl: "ws://localhost:4200" }),
);

const page = (path = "/projects") => proxy(new NextRequest(`https://app.trylift.dev${path}`));
const nonceOf = (policy: string | null) => policy?.match(/'nonce-([^']+)'/)?.[1];

describe("the Content-Security-Policy", () => {
  it("runs only scripts with the nonce, and what they load", () => {
    expect(production.get("script-src")).toEqual([
      "'self'",
      "'nonce-bm9uY2U='",
      "'strict-dynamic'",
    ]);
    expect(production.get("object-src")).toEqual(["'none'"]);
    expect(production.get("base-uri")).toEqual(["'none'"]);
  });

  it("allows eval only in development, where React's tooling needs it", () => {
    expect(development.get("script-src")).toContain("'unsafe-eval'");
    for (const values of production.values()) expect(values).not.toContain("'unsafe-eval'");
    expect(development.get("script-src")).not.toContain("'unsafe-inline'");
  });

  it("connects to the API and the collab server, and loads GitHub's avatars and Monaco's worker", () => {
    expect(production.get("connect-src")).toEqual(["'self'", "wss://app.trylift.dev"]);
    expect(development.get("connect-src")).toEqual(["'self'", "ws://localhost:4200"]);
    // Accounts' avatars, and identicons (the fixtures'), which github.com serves.
    expect(production.get("img-src")).toEqual([
      "'self'",
      "data:",
      "https://avatars.githubusercontent.com",
      "https://github.com",
    ]);
    expect(production.get("worker-src")).toEqual(["'self'"]);
    expect(production.get("frame-ancestors")).toEqual(["'none'"]);
  });

  it("reports to the API, both ways browsers do", () => {
    expect(production.get("report-uri")).toEqual(["/api/v1/csp-reports"]);
    expect(production.get("report-to")).toEqual(["csp"]);
  });

  it("leaves out a collab URL that isn't one, rather than failing every page", () => {
    const policy = contentSecurityPolicy({ nonce: "n", development: false, collabUrl: "" });
    expect(directives(policy).get("connect-src")).toEqual(["'self'"]);
  });
});

describe("the proxy", () => {
  it("sends the policy report-only, and hands Next.js the same nonce to stamp its scripts with", () => {
    const response = page();
    const policy = response.headers.get(CSP_HEADER);
    expect(nonceOf(policy)).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    // NextResponse.next({ request }) forwards request headers to the render this way.
    expect(response.headers.get("x-middleware-override-headers")).toContain(
      CSP_HEADER.toLowerCase(),
    );
    expect(response.headers.get(`x-middleware-request-${CSP_HEADER.toLowerCase()}`)).toBe(policy);
    expect(response.headers.get("Reporting-Endpoints")).toBe('csp="/api/v1/csp-reports"');
    // Nothing is blocked yet.
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("makes a new nonce for every request", () => {
    const nonces = new Set(
      Array.from({ length: 50 }, () => nonceOf(page().headers.get(CSP_HEADER))),
    );
    expect(nonces.size).toBe(50);
  });

  it("runs on pages, never on the API, built files or the mocks' worker, nor on prefetches", () => {
    const [matcher] = config.matcher;
    const pattern = new RegExp(`^${matcher?.source}$`);
    for (const path of ["/", "/projects", "/p/prj_0123456789abcdefghijklmn", "/login"]) {
      expect(pattern.test(path), path).toBe(true);
    }
    for (const path of [
      "/api/v1/me",
      "/_next/static/chunks/app.js",
      "/_next/image",
      "/mockServiceWorker.js",
    ]) {
      expect(pattern.test(path), path).toBe(false);
    }
    expect(matcher?.missing).toContainEqual({ type: "header", key: "next-router-prefetch" });
  });
});

/** The layout's providers don't matter here: only whether it waits for a request. */
function NoProviders() {
  return null;
}

describe("the root layout", () => {
  it("renders every page per request, so each gets its own nonce", async () => {
    const connection = vi.fn(async () => {});
    vi.doMock("next/server", () => ({ connection }));
    vi.doMock("geist/font/sans", () => ({ GeistSans: { variable: "sans" } }));
    vi.doMock("geist/font/mono", () => ({ GeistMono: { variable: "mono" } }));
    vi.doMock("@/app/providers", () => ({ Providers: NoProviders }));
    const { default: RootLayout } = await import("@/app/layout");
    await RootLayout({ children: null });
    expect(connection).toHaveBeenCalledOnce();
    vi.doUnmock("next/server");
  });
});

describe("Zod in the browser", () => {
  it("never compiles with eval, which the policy doesn't allow", async () => {
    expect(z.config().jitless).not.toBe(true);
    await import("@/instrumentation-client");
    expect(z.config().jitless).toBe(true);
  });
});
