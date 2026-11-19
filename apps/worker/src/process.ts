import { spawn } from "node:child_process";

export interface RunResult {
  /** The exit code; null when a signal ended it. */
  code: number | null;
  timedOut: boolean;
  /** Ended because the caller's signal aborted it, e.g. a canceled build. */
  aborted?: boolean;
}

export interface RunOptions {
  cwd?: string;
  /** The child's whole environment: build it with `childEnv`, never pass the worker's own. */
  env: NodeJS.ProcessEnv;
  /** After this, SIGTERM; 10 seconds later, SIGKILL. */
  timeoutMs?: number;
  /** Every line of stdout and stderr, without its line break. */
  onLine?: (line: string) => void;
  /** Aborting it stops the program like a timeout does: SIGTERM, then SIGKILL 10 seconds later. */
  signal?: AbortSignal;
}

const KILL_GRACE_MS = 10_000;

/**
 * The environment a tool runs with: PATH and HOME (Docker and git read config there), the
 * Docker and locale settings when set, and `extra`. Never the worker's secrets (WORKER_TOKEN,
 * REDIS_URL, LIFT_PG_URL), which a build tool has no business seeing.
 */
export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const pass = ["PATH", "HOME", "TMPDIR", "LANG", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT"];
  const env: NodeJS.ProcessEnv = {};
  for (const name of pass) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return { ...env, ...extra };
}

/** Runs a program with arguments (no shell), streaming its output line by line. */
export function run(
  command: string,
  args: readonly string[],
  options: RunOptions,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let timedOut = false;
    let aborted = false;
    let killer: NodeJS.Timeout | undefined;
    const stop = () => {
      if (killer) return;
      child.kill("SIGTERM");
      killer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    };
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            stop();
          }, options.timeoutMs);
    const onAbort = () => {
      aborted = true;
      stop();
    };
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });

    for (const output of [child.stdout, child.stderr]) {
      let rest = "";
      output.setEncoding("utf8");
      output.on("data", (chunk: string) => {
        const lines = (rest + chunk).split("\n");
        rest = lines.pop() ?? "";
        for (const line of lines) options.onLine?.(line.replace(/\r$/, ""));
      });
      output.on("end", () => {
        if (rest) options.onLine?.(rest.replace(/\r$/, ""));
        rest = "";
      });
    }

    child.on("error", (error) => {
      clearTimeout(timer);
      clearTimeout(killer);
      options.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({ code, timedOut, ...(aborted ? { aborted } : {}) });
    });
  });
}
