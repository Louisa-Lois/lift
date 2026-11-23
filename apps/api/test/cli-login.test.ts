import { createHash, randomBytes } from "node:crypto";
import { schema } from "@lift/db";
import { createTestDatabase, type TestDatabase } from "@lift/db/testing";
import {
  API_BASE_PATH,
  ApiToken,
  CliLoginDecisionResponse,
  CreatedApiToken,
  CreateSessionResponse,
  cursorPage,
  PERSONAL_TOKEN_PATTERN,
  PollCliLoginResponse,
  Problem,
  SESSION_COOKIE,
  StartCliLoginResponse,
  type TokenScope,
  User,
} from "@lift/shared";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers/app";
import { fakeGithub } from "./helpers/github";
import { as, signIn } from "./helpers/session";

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

/** PUBLIC_URL in tests, so the origin the dashboard's own requests carry. */
const DASHBOARD = "http://localhost:3000";
const CODE_FORMAT = /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/;
/** A well-formed code no login has: A is not in the alphabet. */
const UNKNOWN_CODE = "AAAA-AAAA";
const MINUTE = 60_000;

const queuePrefix = `test-${randomBytes(4).toString("hex")}`;
const logLines: string[] = [];
const others: TestApp[] = [];

let database: TestDatabase;
let app: TestApp;
let session: string;
let me: User;

beforeAll(async () => {
  database = await createTestDatabase();
  app = await buildTestApp(
    database,
    { LOG_LEVEL: "info" },
    {
      githubFetch: fakeGithub().fetch,
      queuePrefix,
      logStream: { write: (line) => void logLines.push(line) },
    },
  );
  session = await signIn(app);
  const response = await app.inject({ method: "GET", url: `${API_BASE_PATH}/me`, ...as(session) });
  me = User.parse(response.json());
}, 60_000);

afterAll(async () => {
  for (const other of others) await other.close();
  if (app) {
    for (const queue of Object.values(app.queues)) await queue.obliterate({ force: true });
    await app.close();
  }
  await database?.drop();
});

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function start(target = app) {
  const response = await target.inject({ method: "POST", url: `${API_BASE_PATH}/auth/cli` });
  expect(response.statusCode).toBe(201);
  return StartCliLoginResponse.parse(response.json());
}

function poll(code: string, pollSecret?: string, target = app) {
  return target.inject({
    method: "GET",
    url: `${API_BASE_PATH}/auth/cli/${code}`,
    ...(pollSecret ? { headers: { authorization: `Bearer ${pollSecret}` } } : {}),
  });
}

async function pollAnswer(code: string, pollSecret: string, target = app) {
  const response = await poll(code, pollSecret, target);
  expect(response.statusCode).toBe(200);
  return PollCliLoginResponse.parse(response.json());
}

/** A decision from the dashboard: signed in, with its origin, unless told otherwise. */
function decide(
  code: string,
  action: "approve" | "deny",
  options: { cookie?: string | null; origin?: string | null; authorization?: string } = {},
) {
  const cookie = options.cookie === undefined ? session : options.cookie;
  const origin = options.origin === undefined ? DASHBOARD : options.origin;
  return app.inject({
    method: "POST",
    url: `${API_BASE_PATH}/auth/cli/${code}/${action}`,
    headers: {
      ...(origin ? { origin } : {}),
      ...(options.authorization ? { authorization: options.authorization } : {}),
    },
    ...(cookie ? as(cookie) : {}),
  });
}

async function row(code: string) {
  const [found] = await database.db
    .select()
    .from(schema.cliLogins)
    .where(eq(schema.cliLogins.code, code));
  return found;
}

async function setExpiry(code: string, msFromNow: number) {
  await database.db
    .update(schema.cliLogins)
    .set({ expiresAt: new Date(Date.now() + msFromNow) })
    .where(eq(schema.cliLogins.code, code));
}

async function cliTokenCount(): Promise<number> {
  const rows = await database.db
    .select({ id: schema.apiTokens.id })
    .from(schema.apiTokens)
    .where(like(schema.apiTokens.name, "lift login%"));
  return rows.length;
}

async function mintToken(scopes: TokenScope[]) {
  const response = await app.inject({
    method: "POST",
    url: `${API_BASE_PATH}/tokens`,
    ...as(session),
    payload: { name: `session test ${scopes.join(" ")}`, scopes },
  });
  return CreatedApiToken.parse(response.json()).token;
}

describe("starting a CLI login", () => {
  it("gives a code, the page to approve it on, and a poll secret stored only as a hash", async () => {
    const before = Date.now();
    const started = await start();

    expect(started.code).toMatch(CODE_FORMAT);
    expect(started.verifyUrl).toBe(`${DASHBOARD}/cli-auth?code=${started.code}`);
    const expiresIn = Date.parse(started.expiresAt) - before;
    expect(expiresIn).toBeGreaterThanOrEqual(10 * MINUTE - 1000);
    expect(expiresIn).toBeLessThanOrEqual(10 * MINUTE + 5000);

    const stored = await row(started.code);
    expect(stored).toMatchObject({ status: "pending", userId: null, tokenId: null });
    expect(stored?.pollSecretHash).toBe(sha256(started.pollSecret));
    expect(JSON.stringify(stored)).not.toContain(started.pollSecret);
  });

  it("deletes logins that expired more than a day ago", async () => {
    const old = await start();
    await setExpiry(old.code, -25 * 60 * MINUTE);
    const recent = await start();
    await setExpiry(recent.code, -MINUTE);

    await start();
    expect(await row(old.code)).toBeUndefined();
    expect(await row(recent.code)).toBeDefined();
  });

  it("answers 429 after 30 starts in a minute", async () => {
    const limited = await buildTestApp(database, {}, { queuePrefix });
    others.push(limited);
    for (let i = 0; i < 30; i++) await start(limited);

    const response = await limited.inject({ method: "POST", url: `${API_BASE_PATH}/auth/cli` });
    expect(response.statusCode).toBe(429);
    expect(Problem.parse(response.json()).code).toBe("rate_limited");
  });
});

describe("polling a CLI login", () => {
  it("answers pending until the user decides", async () => {
    const started = await start();
    expect(await pollAnswer(started.code, started.pollSecret)).toEqual({ status: "pending" });
  });

  it("gives an unknown code, a wrong secret and no secret the same 404", async () => {
    const started = await start();
    const answers = [
      await poll(UNKNOWN_CODE, started.pollSecret),
      await poll(started.code, `${started.pollSecret.slice(0, -1)}x`),
      await poll(started.code),
    ];
    for (const response of answers) expect(response.statusCode).toBe(404);
    const details = answers.map((response) => Problem.parse(response.json()).detail);
    expect(new Set(details).size).toBe(1);
  });

  it("answers expired once the code has expired", async () => {
    const started = await start();
    await setExpiry(started.code, -1000);
    expect(await pollAnswer(started.code, started.pollSecret)).toEqual({ status: "expired" });
  });
});

describe("approving a CLI login", () => {
  it("gives the CLI an admin token of the approver's, once", async () => {
    const started = await start();
    const approved = await decide(started.code, "approve");
    expect(approved.statusCode).toBe(200);
    expect(CliLoginDecisionResponse.parse(approved.json())).toEqual({
      code: started.code,
      status: "approved",
    });

    const answer = await pollAnswer(started.code, started.pollSecret);
    if (answer.status !== "approved") throw new Error(`expected approved, got ${answer.status}`);
    expect(answer.token).toMatch(PERSONAL_TOKEN_PATTERN);

    const asCli = await app.inject({
      method: "GET",
      url: `${API_BASE_PATH}/me`,
      headers: { authorization: `Bearer ${answer.token}` },
    });
    expect(User.parse(asCli.json()).id).toBe(me.id);

    const list = await app.inject({
      method: "GET",
      url: `${API_BASE_PATH}/tokens`,
      ...as(session),
    });
    const listed = cursorPage(ApiToken)
      .parse(list.json())
      .data.find((token) => token.prefix === answer.token.slice(0, 12));
    expect(listed?.name).toMatch(/^lift login · \d{4}-\d{2}-\d{2}$/);
    expect(listed?.scopes).toEqual(["admin"]);
    expect((await row(started.code))?.tokenId).toBe(listed?.id);

    expect(await pollAnswer(started.code, started.pollSecret)).toEqual({ status: "expired" });
  });

  it("hands out one token when two polls arrive at once", async () => {
    const started = await start();
    await decide(started.code, "approve");
    const before = await cliTokenCount();

    const answers = await Promise.all([
      pollAnswer(started.code, started.pollSecret),
      pollAnswer(started.code, started.pollSecret),
    ]);
    expect(answers.map((answer) => answer.status).sort()).toEqual(["approved", "expired"]);
    expect(await cliTokenCount()).toBe(before + 1);
  });

  it("can be collected up to 30 seconds after the code expires, not later", async () => {
    const late = await start();
    await decide(late.code, "approve");
    await setExpiry(late.code, -10_000);
    expect((await pollAnswer(late.code, late.pollSecret)).status).toBe("approved");

    const tooLate = await start();
    await decide(tooLate.code, "approve");
    await setExpiry(tooLate.code, -31_000);
    expect(await pollAnswer(tooLate.code, tooLate.pollSecret)).toEqual({ status: "expired" });
  });

  it("gives no token once the approver is off the invite list", async () => {
    const started = await start();
    await decide(started.code, "approve");
    const before = await cliTokenCount();
    const stricter = await buildTestApp(
      database,
      { ALLOWED_GITHUB_LOGINS: "vitalik-hakim" },
      { queuePrefix },
    );
    others.push(stricter);

    expect(await pollAnswer(started.code, started.pollSecret, stricter)).toEqual({
      status: "denied",
    });
    expect(await pollAnswer(started.code, started.pollSecret)).toEqual({ status: "denied" });
    expect(await cliTokenCount()).toBe(before);
    expect((await row(started.code))?.tokenId).toBeNull();
  });

  it("can't approve an unknown code, an expired one, or one already decided", async () => {
    expect((await decide(UNKNOWN_CODE, "approve")).statusCode).toBe(404);

    const expired = await start();
    await setExpiry(expired.code, -1000);
    const late = await decide(expired.code, "approve");
    expect(late.statusCode).toBe(409);
    expect(Problem.parse(late.json()).detail).toBe("This code expired. Run `lift login` again.");

    const twice = await start();
    await decide(twice.code, "approve");
    const again = await decide(twice.code, "approve");
    expect(again.statusCode).toBe(409);
    expect(Problem.parse(again.json()).detail).toBe("This login was already approved.");
  });
});

describe("denying a CLI login", () => {
  it("tells the CLI, and the code can't be approved afterwards", async () => {
    const started = await start();
    const denied = await decide(started.code, "deny");
    expect(CliLoginDecisionResponse.parse(denied.json())).toEqual({
      code: started.code,
      status: "denied",
    });

    expect(await pollAnswer(started.code, started.pollSecret)).toEqual({ status: "denied" });
    const approved = await decide(started.code, "approve");
    expect(approved.statusCode).toBe(409);
    expect(Problem.parse(approved.json()).detail).toBe("This login was already denied.");
  });
});

describe("a CLI login decision", () => {
  it("takes a dashboard session: a personal token gets 403, even an admin one", async () => {
    const started = await start();
    const token = await mintToken(["admin"]);
    const response = await decide(started.code, "approve", {
      cookie: null,
      authorization: `Bearer ${token}`,
    });
    expect(response.statusCode).toBe(403);
    expect((await row(started.code))?.status).toBe("pending");
  });

  it("takes the dashboard's own origin: none, or a deployed app's, gets 403", async () => {
    const started = await start();
    for (const origin of [null, "https://shop-demo.apps.trylift.dev", "http://localhost:3001"]) {
      for (const action of ["approve", "deny"] as const) {
        const response = await decide(started.code, action, { origin });
        expect(response.statusCode, `${action} from ${origin}`).toBe(403);
      }
    }
    expect((await row(started.code))?.status).toBe("pending");
  });

  it("needs a signed-in user", async () => {
    const started = await start();
    expect((await decide(started.code, "approve", { cookie: null })).statusCode).toBe(401);
  });
});

describe("swapping a personal token for a session", () => {
  const exchange = (headers: Record<string, string>, cookies?: Record<string, string>) =>
    app.inject({
      method: "POST",
      url: `${API_BASE_PATH}/auth/session`,
      headers,
      ...(cookies ? { cookies } : {}),
    });

  it("gives an admin token a session cookie that works on its own", async () => {
    const token = await mintToken(["admin"]);
    const response = await exchange({ authorization: `Bearer ${token}` });
    expect(response.statusCode).toBe(200);
    const body = CreateSessionResponse.parse(response.json());
    expect(body.user.id).toBe(me.id);

    const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
    // A cookie's Expires has whole seconds.
    const expiresSecond = Math.floor(Date.parse(body.expiresAt) / 1000) * 1000;
    expect(Date.parse(String(cookie?.expires))).toBe(expiresSecond);

    const asBrowser = await app.inject({
      method: "GET",
      url: `${API_BASE_PATH}/me`,
      ...as(String(cookie?.value)),
    });
    expect(User.parse(asBrowser.json()).id).toBe(me.id);
  });

  it("refuses read and deploy tokens, which a session would outrank", async () => {
    for (const scope of ["read", "deploy"] as const) {
      const token = await mintToken([scope]);
      const response = await exchange({ authorization: `Bearer ${token}` });
      expect(response.statusCode, scope).toBe(403);
      expect(response.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
    }
  });

  it("refuses a session, and a caller with nothing", async () => {
    expect((await exchange({}, { [SESSION_COOKIE]: session })).statusCode).toBe(403);
    expect((await exchange({})).statusCode).toBe(401);
  });
});

describe("the logs", () => {
  it("never hold a poll secret or a token", async () => {
    const started = await start();
    await decide(started.code, "approve");
    const answer = await pollAnswer(started.code, started.pollSecret);
    if (answer.status !== "approved") throw new Error(`expected approved, got ${answer.status}`);
    await app.inject({
      method: "POST",
      url: `${API_BASE_PATH}/auth/session`,
      headers: { authorization: `Bearer ${answer.token}` },
    });

    const logged = logLines.join("\n");
    expect(logged).toContain("CLI login collected its token");
    expect(logged).toContain("session created from a token");
    expect(logged).not.toContain(started.pollSecret);
    expect(logged).not.toContain(answer.token);
  });
});
