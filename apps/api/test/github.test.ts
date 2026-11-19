import { createTestDatabase, type TestDatabase } from "@lift/db/testing";
import {
  API_BASE_PATH,
  cursorPage,
  GithubBranch,
  GithubFile,
  GithubRepo,
  GithubTree,
  Problem,
} from "@lift/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers/app";
import { BIG_FILE, fakeGithub, REPO_FILES, treeShaOf } from "./helpers/github";
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

const MAIN_SHA = "3f9c2a1b7d4e5f60718293a4b5c6d7e8f9012345";
const DEV_SHA = "a".repeat(40);
const lastCall = (pathname: string) =>
  github.calls.findLast((entry) => entry.url.pathname === pathname);

describe("GET /github/repos/:owner/:repo/tree", () => {
  it("lists the default branch's files, with the commit it resolved to", async () => {
    const response = await get("/github/repos/lift-demo/next-hello/tree");
    expect(response.statusCode).toBe(200);
    const tree = GithubTree.parse(response.json());
    expect(tree.sha).toBe(MAIN_SHA);
    expect(tree.truncated).toBe(false);
    // Folders and the submodule aren't files.
    expect(tree.files.map((file) => file.path)).toEqual([
      "README.md",
      "app/page.tsx",
      BIG_FILE.path,
      "package.json",
      "public/logo.png",
    ]);
    expect(tree.files.find((file) => file.path === BIG_FILE.path)?.size).toBe(BIG_FILE.size);
    const call = lastCall(`/repos/lift-demo/next-hello/git/trees/${treeShaOf(MAIN_SHA)}`);
    expect(call?.url.searchParams.get("recursive")).toBe("1");
    expect(call?.headers.get("authorization")).toBe(`Bearer ${github.token}`);
  });

  it("reads a branch or a commit when asked", async () => {
    const byBranch = GithubTree.parse(
      (await get("/github/repos/lift-demo/next-hello/tree?ref=dev")).json(),
    );
    expect(byBranch.sha).toBe(DEV_SHA);
    const bySha = GithubTree.parse(
      (await get(`/github/repos/lift-demo/next-hello/tree?ref=${MAIN_SHA}`)).json(),
    );
    expect(bySha.sha).toBe(MAIN_SHA);
  });

  it("keeps at most 5,000 files, and says when some are left out", async () => {
    const big = GithubTree.parse(
      (await get("/github/repos/lift-demo/express-postgres/tree")).json(),
    );
    expect(big.files).toHaveLength(5_000);
    expect(big.truncated).toBe(true);
    // GitHub truncates a tree itself past 100,000 entries.
    const cut = GithubTree.parse((await get("/github/repos/ama-owusu/notes/tree?ref=main")).json());
    expect(cut.truncated).toBe(true);
  });

  it("answers 404 for an unknown ref or a repo the user can't read", async () => {
    const ref = await get("/github/repos/lift-demo/next-hello/tree?ref=nope");
    expect(ref.statusCode).toBe(404);
    expect(Problem.parse(ref.json()).detail).toContain("nope");
    expect((await get("/github/repos/lift-demo/secret/tree")).statusCode).toBe(404);
  });
});

describe("GET /github/repos/:owner/:repo/contents", () => {
  it("returns a text file, decoded", async () => {
    const response = await get("/github/repos/lift-demo/next-hello/contents?path=package.json");
    expect(response.statusCode).toBe(200);
    const file = GithubFile.parse(response.json());
    expect(file.path).toBe("package.json");
    expect(file.content).toBe(REPO_FILES["package.json"]);
    expect(file.size).toBe(Buffer.byteLength(file.content));
    const readme = GithubFile.parse(
      (await get("/github/repos/lift-demo/next-hello/contents?path=README.md")).json(),
    );
    expect(readme.content).toContain("Ça marche.");
  });

  it("asks GitHub for the ref and the path it was given", async () => {
    const response = await get(
      `/github/repos/lift-demo/next-hello/contents?path=app/page.tsx&ref=${DEV_SHA}`,
    );
    expect(GithubFile.parse(response.json()).content).toBe(REPO_FILES["app/page.tsx"]);
    const call = lastCall("/repos/lift-demo/next-hello/contents/app/page.tsx");
    expect(call?.url.searchParams.get("ref")).toBe(DEV_SHA);
  });

  it("refuses a folder, a binary file and a file over 1 MB, on the path field", async () => {
    for (const [path, detail] of [
      ["app", "app is a folder, not a file."],
      ["public/logo.png", "public/logo.png isn't a text file."],
      [BIG_FILE.path, `${BIG_FILE.path} is 2.4 MB; Lift reads files up to 1 MB.`],
    ] as const) {
      const response = await get(`/github/repos/lift-demo/next-hello/contents?path=${path}`);
      expect(response.statusCode, path).toBe(400);
      expect(Problem.parse(response.json()), path).toMatchObject({
        code: "validation_failed",
        detail,
        fields: { path: detail },
      });
    }
  });

  it("answers 404 for a missing file or ref, and 400 for a path outside the repo", async () => {
    const missing = await get("/github/repos/lift-demo/next-hello/contents?path=nope.txt");
    expect(missing.statusCode).toBe(404);
    const ref = await get("/github/repos/lift-demo/next-hello/contents?path=README.md&ref=nope");
    expect(ref.statusCode).toBe(404);
    const outside = await get("/github/repos/lift-demo/next-hello/contents?path=../etc/passwd");
    expect(outside.statusCode).toBe(400);
  });
});
