import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cloneCommit, cloneSteps, gitAuthEnv, tokenForms } from "../src/build/clone";
import { childEnv, run } from "../src/process";

const TOKEN = `gho_${"t".repeat(36)}`;
let work: string;
let remote: string;
let first: string;
let second: string;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const lines: string[] = [];
  const env = childEnv({
    GIT_AUTHOR_NAME: "Ama",
    GIT_AUTHOR_EMAIL: "ama@example.test",
    GIT_COMMITTER_NAME: "Ama",
    GIT_COMMITTER_EMAIL: "ama@example.test",
  });
  const result = await run("git", args, { cwd, env, onLine: (line) => lines.push(line) });
  if (result.code !== 0) throw new Error(`git ${args.join(" ")}: ${lines.join("\n")}`);
  return lines.join("\n");
}

// A local repository with two commits stands in for GitHub.
beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), "lift-clone-test-"));
  const source = path.join(work, "source");
  await git(work, "init", "--quiet", "--initial-branch", "main", source);
  await writeFile(path.join(source, "version.txt"), "one\n");
  await git(source, "add", ".");
  await git(source, "commit", "--quiet", "-m", "first");
  first = await git(source, "rev-parse", "HEAD");
  await writeFile(path.join(source, "version.txt"), "two\n");
  await git(source, "commit", "--quiet", "-am", "second");
  second = await git(source, "rev-parse", "HEAD");
  const bare = path.join(work, "remote.git");
  await git(work, "clone", "--quiet", "--bare", source, bare);
  await git(bare, "config", "uploadpack.allowAnySHA1InWant", "true");
  remote = `file://${bare}`;
});

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

describe("cloning a commit", () => {
  it("checks out exactly the commit asked for, not the branch head", async () => {
    const dir = path.join(work, "dep_first");
    const result = await cloneCommit({
      dir,
      owner: "lift-demo",
      name: "next-hello",
      sha: first,
      token: TOKEN,
      remoteUrl: remote,
      onLine: () => {},
      timeoutMs: 60_000,
    });
    expect(result).toEqual({ code: 0, timedOut: false });
    expect(await readFile(path.join(dir, "version.txt"), "utf8")).toBe("one\n");
    expect(await git(dir, "rev-parse", "HEAD")).toBe(first);
    expect(second).not.toBe(first);
    // Nothing about the token was written to disk.
    const config = await readFile(path.join(dir, ".git", "config"), "utf8");
    expect(config).not.toContain(TOKEN);
    expect(config).not.toContain("extraheader");
  });

  it("keeps the token out of every argv and the remote URL", () => {
    const steps = cloneSteps({
      dir: "/var/lib/lift/builds/dep_x",
      owner: "lift-demo",
      name: "next-hello",
      sha: first,
      token: TOKEN,
      onLine: () => {},
      timeoutMs: 60_000,
    });
    for (const [args] of steps) {
      for (const form of tokenForms(TOKEN)) expect(args.join(" ")).not.toContain(form);
    }
    expect(steps[1]?.[0]).toContain("https://github.com/lift-demo/next-hello.git");
    // Only the fetch carries credentials, as an Authorization header set through GIT_CONFIG_*.
    const withAuth = steps.filter(([, env]) => env.GIT_CONFIG_VALUE_0 !== undefined);
    expect(withAuth.map(([args]) => args[2])).toEqual(["fetch"]);
    expect(gitAuthEnv(TOKEN)).toMatchObject({
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${tokenForms(TOKEN)[1]}`,
      GIT_TERMINAL_PROMPT: "0",
    });
  });

  it("fails on a commit the repository doesn't have", async () => {
    const result = await cloneCommit({
      dir: path.join(work, "dep_missing"),
      owner: "lift-demo",
      name: "next-hello",
      sha: "b".repeat(40),
      token: TOKEN,
      remoteUrl: remote,
      onLine: () => {},
      timeoutMs: 60_000,
    });
    expect(result.code).not.toBe(0);
  });
});
