import { describe, expect, it } from "vitest";
import { childEnv, run } from "../src/process";

const node = process.execPath;

describe("running a tool", () => {
  it("streams stdout and stderr line by line and returns the exit code", async () => {
    const lines: string[] = [];
    const result = await run(
      node,
      [
        "-e",
        "console.log('one\\ntwo'); console.error('three'); process.stdout.write('four'); process.exit(3)",
      ],
      { env: childEnv(), onLine: (line) => lines.push(line) },
    );
    expect(result).toEqual({ code: 3, timedOut: false });
    expect(lines.sort()).toEqual(["four", "one", "three", "two"]);
  });

  it("stops a tool that runs past its timeout", async () => {
    const started = Date.now();
    const result = await run(node, ["-e", "setInterval(() => {}, 1000)"], {
      env: childEnv(),
      timeoutMs: 200,
    });
    expect(result.timedOut).toBe(true);
    expect(result.code).toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("stops a tool when its signal aborts, as for a canceled build", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const result = run(node, ["-e", "setTimeout(() => {}, 30000)"], {
      env: childEnv(),
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    expect(await result).toEqual({ code: null, timedOut: false, aborted: true });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("gives tools PATH and HOME, never the worker's secrets", () => {
    const saved = { ...process.env };
    process.env.WORKER_TOKEN = "w".repeat(32);
    process.env.REDIS_URL = "redis://:secret@10.0.0.5:6379";
    process.env.LIFT_PG_URL = "postgres://postgres:secret@lift-pg/postgres";
    try {
      const env = childEnv({ BUILDKIT_HOST: "tcp://buildkit:1234" });
      expect(env.PATH).toBe(process.env.PATH);
      expect(env.BUILDKIT_HOST).toBe("tcp://buildkit:1234");
      expect(env).not.toHaveProperty("WORKER_TOKEN");
      expect(env).not.toHaveProperty("REDIS_URL");
      expect(env).not.toHaveProperty("LIFT_PG_URL");
    } finally {
      process.env = saved;
    }
  });
});
