import { mkdir, rm } from "node:fs/promises";
import { childEnv, type RunResult, run } from "../process";

/** The secrets a clone token leaks as, so the log sink can scrub every form. */
export function tokenForms(token: string): string[] {
  return [token, Buffer.from(`x-access-token:${token}`).toString("base64")];
}

/**
 * git's settings for an authenticated fetch from GitHub, as environment variables: the token rides
 * in an Authorization header set through GIT_CONFIG_*, never in argv (visible in `ps`) or in the
 * remote URL (echoed in git's errors), and nothing is written to disk.
 */
export function gitAuthEnv(token: string): Record<string, string> {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
}

export interface CloneInput {
  dir: string;
  owner: string;
  name: string;
  sha: string;
  token: string;
  /** Tests clone a local repository instead of GitHub. */
  remoteUrl?: string;
  onLine: (line: string) => void;
  timeoutMs: number;
  /** Stops git when the deployment is canceled. */
  signal?: AbortSignal;
}

/** The git commands of a clone, as [args, environment] pairs; tests check no argv holds the token. */
export function cloneSteps(input: CloneInput): [string[], NodeJS.ProcessEnv][] {
  const remote = input.remoteUrl ?? `https://github.com/${input.owner}/${input.name}.git`;
  const plain = childEnv({ GIT_TERMINAL_PROMPT: "0" });
  return [
    [["init", "--quiet", input.dir], plain],
    [["-C", input.dir, "remote", "add", "origin", remote], plain],
    [
      ["-C", input.dir, "fetch", "--quiet", "--depth", "1", "--no-tags", "origin", input.sha],
      childEnv(gitAuthEnv(input.token)),
    ],
    [
      ["-C", input.dir, "-c", "advice.detachedHead=false", "checkout", "--quiet", "FETCH_HEAD"],
      plain,
    ],
  ];
}

/**
 * Clones exactly one commit into an empty `dir` (docs/prd/04-infrastructure.md, "Build job"):
 * `git init`, a shallow fetch of the SHA, then a checkout of FETCH_HEAD.
 */
export async function cloneCommit(input: CloneInput): Promise<RunResult> {
  await rm(input.dir, { recursive: true, force: true });
  await mkdir(input.dir, { recursive: true, mode: 0o700 });
  for (const [args, env] of cloneSteps(input)) {
    const result = await run("git", args, {
      env,
      timeoutMs: input.timeoutMs,
      onLine: input.onLine,
      signal: input.signal,
    });
    if (result.code !== 0 || result.timedOut) return result;
  }
  return { code: 0, timedOut: false };
}
