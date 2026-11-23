import { randomBytes } from "node:crypto";
import { createTestDatabase, type TestDatabase } from "@lift/db/testing";
import { API_BASE_PATH, CreatedApiToken, newId, User } from "@lift/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server";
import { AUTH_ENV } from "./helpers/app";
import { testEnv } from "./helpers/env";
import { fakeGithub } from "./helpers/github";
import { as, asAgent, signIn } from "./helpers/session";

/**
 * Every public API route needs a session or a token unless it's on this list, which matches the
 * routes docs/prd/01-backend-api.md marks public. Marking another route public means adding it
 * here, on purpose.
 */
const PUBLIC_ROUTES = [
  "GET /api/v1/health",
  "GET /api/v1/auth/github/start",
  "GET /api/v1/auth/github/callback",
  "POST /api/v1/auth/logout",
  // `lift login` starts a login and polls it with its own poll secret, before it has a token.
  "POST /api/v1/auth/cli",
  "GET /api/v1/auth/cli/:code",
  "POST /api/v1/webhooks/github",
  // Browsers send Content-Security-Policy reports without a session; the route only logs them.
  "POST /api/v1/csp-reports",
];

/**
 * GET routes the agent service may not call, though they only read: tokens are none of its
 * business, and credentials hold a password. Every other GET route takes it; nothing else does.
 */
const AGENT_REFUSED = ["GET /api/v1/tokens", "GET /api/v1/databases/:databaseId/credentials"];

/** A well-formed value for each path parameter; a route with a new parameter needs one here. */
const SAMPLE_PARAMS: Record<string, string> = {
  projectId: newId("prj"),
  serviceId: newId("svc"),
  deploymentId: newId("dep"),
  tokenId: newId("tok"),
  databaseId: newId("db"),
  planId: newId("pln"),
  userId: newId("usr"),
  owner: "lift-demo",
  repo: "next-hello",
  code: "BCDF-GHJK",
};

interface Route {
  method: string;
  url: string;
  public: boolean;
}

const queuePrefix = `test-${randomBytes(4).toString("hex")}`;
const routes: Route[] = [];
let database: TestDatabase;
let app: ReturnType<typeof buildServer>;
let valid: string;
let revoked: string;
let userId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  app = buildServer(testEnv({ DATABASE_URL: database.url, ...AUTH_ENV }), {
    githubFetch: fakeGithub().fetch,
    queuePrefix,
  });
  // Route plugins load at ready(), so this sees every route they register.
  app.addHook("onRoute", (route) => {
    if (!route.url.startsWith(API_BASE_PATH)) return;
    for (const method of [route.method].flat()) {
      if (method === "HEAD") continue;
      routes.push({ method, url: route.url, public: route.config?.public === true });
    }
  });
  await app.ready();

  const session = await signIn(app);
  const me = await app.inject({ method: "GET", url: `${API_BASE_PATH}/me`, ...as(session) });
  userId = User.parse(me.json()).id;
  const mint = async () => {
    const response = await app.inject({
      method: "POST",
      url: `${API_BASE_PATH}/tokens`,
      ...as(session),
      payload: { name: "coverage", scopes: ["admin"] },
    });
    return CreatedApiToken.parse(response.json());
  };
  valid = (await mint()).token;
  const old = await mint();
  await app.inject({ method: "DELETE", url: `${API_BASE_PATH}/tokens/${old.id}`, ...as(session) });
  revoked = old.token;
}, 60_000);

afterAll(async () => {
  if (app) {
    for (const queue of Object.values(app.queues)) await queue.obliterate({ force: true });
    await app.close();
  }
  await database?.drop();
});

function fill(url: string): string {
  return url.replace(/:(\w+)/g, (_match, name: string) => {
    const value = SAMPLE_PARAMS[name];
    if (!value) throw new Error(`add a sample value for :${name} to SAMPLE_PARAMS`);
    return value;
  });
}

const key = (route: Route) => `${route.method} ${route.url}`;

function call(route: Route, authorization?: string) {
  return app.inject({
    method: route.method as "GET",
    url: fill(route.url),
    ...(authorization ? { headers: { authorization } } : {}),
  });
}

describe("every API route", () => {
  it("is found, and only the agreed ones are public", () => {
    expect(routes.length).toBeGreaterThan(20);
    expect(
      routes
        .filter((route) => route.public)
        .map(key)
        .sort(),
    ).toEqual([...PUBLIC_ROUTES].sort());
  });

  it("refuses a caller with no session or token, before anything else runs", async () => {
    for (const route of routes.filter((route) => !route.public)) {
      const response = await call(route);
      expect(response.statusCode, key(route)).toBe(401);
    }
  });

  it("refuses a revoked token", async () => {
    for (const route of routes.filter((route) => !route.public)) {
      const response = await call(route, `Bearer ${revoked}`);
      expect(response.statusCode, key(route)).toBe(401);
    }
  });

  it("accepts a personal token", async () => {
    for (const route of routes.filter((route) => !route.public)) {
      const response = await call(route, `Bearer ${valid}`);
      // A made-up ID is a 404 and a missing body a 400; neither may be a 401.
      expect(response.statusCode, key(route)).not.toBe(401);
    }
  });

  it("lets the agent service read, and nothing else", async () => {
    for (const route of routes.filter((route) => !route.public)) {
      const response = await app.inject({
        method: route.method as "GET",
        url: fill(route.url),
        ...asAgent(userId),
      });
      if (route.method === "GET" && !AGENT_REFUSED.includes(key(route))) {
        expect(response.statusCode, key(route)).not.toBe(401);
        expect(response.statusCode, key(route)).not.toBe(403);
      } else {
        expect(response.statusCode, key(route)).toBe(403);
      }
    }
  });

  it("lets the public ones through without credentials", async () => {
    for (const route of routes.filter((route) => route.public)) {
      const response = await call(route);
      expect(response.statusCode, key(route)).not.toBe(401);
    }
  });
});
