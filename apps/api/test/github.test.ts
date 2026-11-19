import { createTestDatabase, type TestDatabase } from "@lift/db/testing";
import { API_BASE_PATH, cursorPage, GithubBranch, GithubRepo, Problem } from "@lift/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers/app";
import { fakeGithub } from "./helpers/github";
import { as, signIn } from "./helpers/session";

let database: TestDatabase;
let app: Awaited<ReturnType<typeof buildTestApp>>;
let session: string;
const github = fakeGithub();

beforeAll(async () => {
  database = await createTestDatabase();
  app = await buildTestApp(database, {}, { githubFetch: github.fetch });
  session = await signIn(app);
}, 60_000);
afterAll(async () => {
  await app?.close();
  await database?.drop();
});

const get = (url: string, signedIn = true) =>
  app.inject({ method: "GET", url: `${API_BASE_PATH}${url}`, ...(signedIn ? as(session) : {}) });

describe("GET /github/repos", () => {
  it("lists repos most recently pushed first, a page at a time", async () => {
    const first = cursorPage(GithubRepo).parse((await get("/github/repos?limit=2")).json());
    expect(first.data.map((repo) => `${repo.owner}/${repo.name}`)).toEqual([
      "lift-demo/next-hello",
      "lift-demo/express-postgres",
    ]);
    expect(first.nextCursor).toBe("2");
    const second = cursorPage(GithubRepo).parse(
      (await get(`/github/repos?limit=2&cursor=${first.nextCursor}`)).json(),
    );
    expect(second.data).toEqual([
      { owner: "ama-owusu", name: "notes", private: true, defaultBranch: "trunk", pushedAt: null },
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it("asks GitHub with the user's own token, never another", async () => {
    const call = github.calls.findLast((entry) => entry.url.pathname === "/user/repos");
    expect(call?.headers.get("authorization")).toBe(`Bearer ${github.token}`);
    expect(call?.url.searchParams.get("affiliation")).toBe(
      "owner,collaborator,organization_member",
    );
  });

  it("searches owner/name without caring about case", async () => {
    const result = cursorPage(GithubRepo).parse((await get("/github/repos?query=HELLO")).json());
    expect(result.data.map((repo) => repo.name)).toEqual(["next-hello"]);
    const byOwner = cursorPage(GithubRepo).parse(
      (await get("/github/repos?query=lift-demo/")).json(),
    );
    expect(byOwner.data).toHaveLength(2);
  });

  it("refuses a cursor it didn't make, and anyone signed out", async () => {
    const bad = await get("/github/repos?cursor=abc");
    expect(Problem.parse(bad.json())).toMatchObject({ code: "validation_failed" });
    expect((await get("/github/repos", false)).statusCode).toBe(401);
  });
});

describe("GET /github/repos/:owner/:repo/branches", () => {
  it("lists every branch", async () => {
    const result = cursorPage(GithubBranch).parse(
      (await get("/github/repos/lift-demo/next-hello/branches")).json(),
    );
    expect(result).toEqual({ data: [{ name: "main" }, { name: "dev" }], nextCursor: null });
  });

  it("answers 404 for a repo the user can't read", async () => {
    const response = await get("/github/repos/lift-demo/secret/branches");
    expect(response.statusCode).toBe(404);
    expect(Problem.parse(response.json()).code).toBe("not_found");
  });
});
