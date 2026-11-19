import { schema } from "@lift/db";
import { createTestDatabase, type TestDatabase } from "@lift/db/testing";
import {
  API_BASE_PATH,
  INVITE_ONLY_PROBLEM_TYPE,
  Problem,
  SESSION_COOKIE,
  User,
} from "@lift/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSecretBox } from "../src/services/crypto";
import { sessionIdFor } from "../src/services/sessions";
import { buildTestApp, TEST_ENCRYPTION_KEY } from "./helpers/app";
import { fakeGithub } from "./helpers/github";

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Injected = Awaited<ReturnType<TestApp["inject"]>>;

const DAY = 24 * 60 * 60 * 1000;
const cookieNamed = (response: Injected, name: string) =>
  response.cookies.find((cookie) => cookie.name === name);

/** Runs the whole browser flow: start, GitHub (faked), callback. */
async function signIn(app: TestApp, next?: string) {
  const query = next ? `?next=${encodeURIComponent(next)}` : "";
  const start = await app.inject({
    method: "GET",
    url: `${API_BASE_PATH}/auth/github/start${query}`,
  });
  const state = new URL(String(start.headers.location)).searchParams.get("state") ?? "";
  const oauth = cookieNamed(start, "lift_oauth");
  const callback = await app.inject({
    method: "GET",
    url: `${API_BASE_PATH}/auth/github/callback?code=test-code&state=${state}`,
    cookies: oauth ? { lift_oauth: oauth.value } : {},
  });
  return { start, callback, session: cookieNamed(callback, SESSION_COOKIE)?.value };
}

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);
afterAll(() => database?.drop());

async function clearAccounts() {
  await database.db.delete(schema.sessions);
  await database.db.delete(schema.users);
}

describe("GET /auth/github/start", () => {
  it("redirects to GitHub with the scopes, a state that matches the signed cookie, and no sign-ups", async () => {
    const app = await buildTestApp(database);
    try {
      const response = await app.inject({
        method: "GET",
        url: `${API_BASE_PATH}/auth/github/start`,
      });
      expect(response.statusCode).toBe(302);
      const location = new URL(String(response.headers.location));
      expect(`${location.origin}${location.pathname}`).toBe(
        "https://github.com/login/oauth/authorize",
      );
      expect(Object.fromEntries(location.searchParams)).toMatchObject({
        client_id: "test-client-id",
        redirect_uri: `http://localhost:3000${API_BASE_PATH}/auth/github/callback`,
        scope: "read:user user:email repo admin:repo_hook",
        allow_signup: "false",
      });

      const cookie = cookieNamed(response, "lift_oauth");
      expect(cookie).toMatchObject({
        httpOnly: true,
        path: `${API_BASE_PATH}/auth/github`,
        maxAge: 600,
        sameSite: "Lax",
      });
      expect(cookie?.secure).toBeFalsy();
      const unsigned = app.unsignCookie(cookie?.value ?? "");
      expect(unsigned.valid).toBe(true);
      expect(JSON.parse(unsigned.value ?? "{}").state).toBe(location.searchParams.get("state"));
    } finally {
      await app.close();
    }
  });

  it("refuses a `next` that leaves the site", async () => {
    const app = await buildTestApp(database);
    try {
      const response = await app.inject({
        method: "GET",
        url: `${API_BASE_PATH}/auth/github/start?next=${encodeURIComponent("//evil.example")}`,
      });
      expect(response.statusCode).toBe(400);
      expect(Problem.parse(response.json()).code).toBe("validation_failed");
    } finally {
      await app.close();
    }
  });

  it("sends you to /login?error=config when GitHub isn't configured", async () => {
    const app = await buildTestApp(database, { GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "" });
    try {
      const response = await app.inject({
        method: "GET",
        url: `${API_BASE_PATH}/auth/github/start`,
      });
      expect(response.headers.location).toBe("http://localhost:3000/login?error=config");
    } finally {
      await app.close();
    }
  });
});

describe("GET /auth/github/callback", () => {
  it("signs in an invited login, ignoring case, and stores the token encrypted", async () => {
    await clearAccounts();
    const github = fakeGithub();
    const app = await buildTestApp(
      database,
      { ALLOWED_GITHUB_LOGINS: "Ama-Owusu, someone-else" },
      { githubFetch: github.fetch },
    );
    try {
      const { callback, session } = await signIn(app);
      expect(callback.statusCode).toBe(302);
      expect(callback.headers.location).toBe("http://localhost:3000/projects");
      const cookie = cookieNamed(callback, SESSION_COOKIE);
      expect(cookie).toMatchObject({ httpOnly: true, path: "/", sameSite: "Lax" });
      expect(cookie?.secure).toBeFalsy();
      const expires = new Date(String(cookie?.expires)).getTime();
      expect(Math.abs(expires - (Date.now() + 14 * DAY))).toBeLessThan(60_000);

      const [user] = await database.db.select().from(schema.users);
      expect(user).toMatchObject({ login: "ama-owusu", githubId: 4242, email: "ama@example.com" });
      expect(user?.githubTokenEnc.includes(Buffer.from(github.token))).toBe(false);
      expect(
        createSecretBox(TEST_ENCRYPTION_KEY).decrypt(user?.githubTokenEnc ?? Buffer.alloc(0)),
      ).toBe(github.token);

      const [row] = await database.db.select().from(schema.sessions);
      expect(row?.id).toBe(sessionIdFor(session ?? ""));
      expect(row?.userId).toBe(user?.id);

      const exchange = github.calls.find(
        (call) => call.url.pathname === "/login/oauth/access_token",
      );
      expect(JSON.parse(exchange?.body ?? "{}")).toMatchObject({
        client_id: "test-client-id",
        client_secret: "test-client-secret",
        code: "test-code",
      });
      const profile = github.calls.find((call) => call.url.pathname === "/user");
      expect(profile?.headers.get("authorization")).toBe(`Bearer ${github.token}`);
      expect(github.calls.some((call) => call.method === "DELETE")).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("goes back to `next`, and signing in again reuses the same user", async () => {
    await clearAccounts();
    const github = fakeGithub();
    const app = await buildTestApp(database, {}, { githubFetch: github.fetch });
    try {
      const first = await signIn(app, "/p/prj_abc?tab=logs");
      expect(first.callback.headers.location).toBe("http://localhost:3000/p/prj_abc?tab=logs");
      await signIn(app);
      expect(await database.db.select().from(schema.users)).toHaveLength(1);
      expect(await database.db.select().from(schema.sessions)).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it("turns away a login that isn't invited: no account, no session, grant revoked", async () => {
    await clearAccounts();
    const github = fakeGithub();
    const app = await buildTestApp(
      database,
      { ALLOWED_GITHUB_LOGINS: "vitalik-hakim,louisa-lois" },
      { githubFetch: github.fetch },
    );
    try {
      const { callback, session } = await signIn(app);
      expect(callback.headers.location).toBe(
        "http://localhost:3000/login?error=invite_only&login=ama-owusu",
      );
      expect(session).toBeUndefined();
      expect(await database.db.select().from(schema.users)).toHaveLength(0);
      expect(await database.db.select().from(schema.sessions)).toHaveLength(0);

      const revoke = github.calls.find((call) => call.method === "DELETE");
      expect(revoke?.url.pathname).toBe("/applications/test-client-id/grant");
      expect(revoke?.headers.get("authorization")).toBe(
        `Basic ${Buffer.from("test-client-id:test-client-secret").toString("base64")}`,
      );
      expect(JSON.parse(revoke?.body ?? "{}")).toEqual({ access_token: github.token });
    } finally {
      await app.close();
    }
  });

  it("refuses a wrong or missing state without calling GitHub", async () => {
    await clearAccounts();
    const github = fakeGithub();
    const app = await buildTestApp(database, {}, { githubFetch: github.fetch });
    try {
      const start = await app.inject({ method: "GET", url: `${API_BASE_PATH}/auth/github/start` });
      const oauth = cookieNamed(start, "lift_oauth")?.value ?? "";
      const wrong = await app.inject({
        method: "GET",
        url: `${API_BASE_PATH}/auth/github/callback?code=test-code&state=${"x".repeat(32)}`,
        cookies: { lift_oauth: oauth },
      });
      const missing = await app.inject({
        method: "GET",
        url: `${API_BASE_PATH}/auth/github/callback?code=test-code&state=${"x".repeat(32)}`,
      });
      for (const response of [wrong, missing]) {
        expect(response.headers.location).toBe("http://localhost:3000/login?error=state");
      }
      expect(github.calls).toHaveLength(0);
      expect(await database.db.select().from(schema.users)).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("explains a cancelled sign-in and a GitHub failure", async () => {
    const app = await buildTestApp(
      database,
      {},
      { githubFetch: fakeGithub({ failTokenExchange: true }).fetch },
    );
    try {
      const cancelled = await app.inject({
        method: "GET",
        url: `${API_BASE_PATH}/auth/github/callback?error=access_denied&state=x`,
      });
      expect(cancelled.headers.location).toBe("http://localhost:3000/login?error=denied");
      const failed = await signIn(app);
      expect(failed.callback.headers.location).toBe("http://localhost:3000/login?error=github");
    } finally {
      await app.close();
    }
  });
});

describe("sessions and /me", () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await buildTestApp(database, {}, { githubFetch: fakeGithub().fetch });
  });
  afterAll(() => app.close());

  const me = (session?: string) =>
    app.inject({
      method: "GET",
      url: `${API_BASE_PATH}/me`,
      cookies: session ? { [SESSION_COOKIE]: session } : {},
    });

  it("answers 401 without a session", async () => {
    const response = await me();
    expect(response.statusCode).toBe(401);
    expect(Problem.parse(response.json())).toMatchObject({
      code: "unauthenticated",
      type: "about:blank",
    });
  });

  it("returns the signed-in user, without sliding a fresh session", async () => {
    await clearAccounts();
    const { session } = await signIn(app);
    const response = await me(session);
    expect(response.statusCode).toBe(200);
    expect(User.parse(response.json())).toMatchObject({ login: "ama-owusu", githubId: 4242 });
    expect(response.json()).not.toHaveProperty("githubTokenEnc");
    expect(cookieNamed(response, SESSION_COOKIE)).toBeUndefined();
  });

  it("slides a session that has been used for more than a day", async () => {
    await clearAccounts();
    const { session } = await signIn(app);
    const id = sessionIdFor(session ?? "");
    await database.db
      .update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() + 12 * DAY) })
      .where(eq(schema.sessions.id, id));
    const response = await me(session);
    expect(response.statusCode).toBe(200);
    expect(cookieNamed(response, SESSION_COOKIE)).toBeDefined();
    const [row] = await database.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, id));
    expect(Math.abs((row?.expiresAt.getTime() ?? 0) - (Date.now() + 14 * DAY))).toBeLessThan(
      60_000,
    );
  });

  it("refuses an expired session", async () => {
    await clearAccounts();
    const { session } = await signIn(app);
    await database.db.update(schema.sessions).set({ expiresAt: new Date(Date.now() - 1000) });
    const response = await me(session);
    expect(response.statusCode).toBe(401);
    expect(cookieNamed(response, SESSION_COOKIE)?.value).toBe("");
  });

  it("signs out a login removed from ALLOWED_GITHUB_LOGINS at its next request", async () => {
    await clearAccounts();
    const { session } = await signIn(app);
    const stricter = await buildTestApp(database, { ALLOWED_GITHUB_LOGINS: "vitalik-hakim" });
    try {
      const response = await stricter.inject({
        method: "GET",
        url: `${API_BASE_PATH}/me`,
        cookies: { [SESSION_COOKIE]: session ?? "" },
      });
      expect(response.statusCode).toBe(401);
      expect(Problem.parse(response.json())).toMatchObject({
        code: "unauthenticated",
        type: INVITE_ONLY_PROBLEM_TYPE,
        detail: "Lift is invite-only for now.",
      });
      expect(await database.db.select().from(schema.sessions)).toHaveLength(0);
    } finally {
      await stricter.close();
    }
  });

  it("ends the session on logout", async () => {
    await clearAccounts();
    const { session } = await signIn(app);
    const response = await app.inject({
      method: "POST",
      url: `${API_BASE_PATH}/auth/logout`,
      cookies: { [SESSION_COOKIE]: session ?? "" },
    });
    expect(response.statusCode).toBe(204);
    expect(cookieNamed(response, SESSION_COOKIE)?.value).toBe("");
    expect(await database.db.select().from(schema.sessions)).toHaveLength(0);
    expect((await me(session)).statusCode).toBe(401);
  });
});

describe("over https", () => {
  it("marks both cookies Secure when PUBLIC_URL is https", async () => {
    await clearAccounts();
    const app = await buildTestApp(
      database,
      { PUBLIC_URL: "https://app.example.test" },
      { githubFetch: fakeGithub().fetch },
    );
    try {
      const { start, callback } = await signIn(app);
      expect(cookieNamed(start, "lift_oauth")?.secure).toBe(true);
      expect(cookieNamed(callback, SESSION_COOKIE)?.secure).toBe(true);
      expect(callback.headers.location).toBe("https://app.example.test/projects");
    } finally {
      await app.close();
    }
  });
});
