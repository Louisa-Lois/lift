import { randomBytes } from "node:crypto";
import { REDIS_STREAMS } from "@lift/shared";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { createLogSink, MAX_LINE_BYTES, scrub } from "../src/log-sink";
import { createLogger } from "../src/logger";

// The local stack's Redis (pnpm stack:up), or CI's through REDIS_URL.
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const log = createLogger("silent");
const keys: string[] = [];

afterAll(async () => {
  if (keys.length > 0) await redis.del(...keys);
  redis.disconnect();
});

function newDeployment(): string {
  const id = `dep_${randomBytes(12).toString("hex")}`;
  keys.push(REDIS_STREAMS.deploymentLogs.key(id));
  return id;
}

async function entries(deploymentId: string) {
  const raw = await redis.xrange(REDIS_STREAMS.deploymentLogs.key(deploymentId), "-", "+");
  return raw.map(([, fields]) => {
    const record: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2)
      record[fields[i] as string] = fields[i + 1] as string;
    return record;
  });
}

describe("the log sink", () => {
  it("writes each line to the deployment's stream in order, with ts, stream and line", async () => {
    const id = newDeployment();
    const sink = createLogSink(redis, id, { log });
    sink.system("Cloning lift-demo/next-hello at 3f9c2a1");
    for (let n = 1; n <= 450; n += 1) sink.write("build", `step ${n}`);
    sink.system("Image built in 2m 03s");
    await sink.flush();
    const written = await entries(id);
    expect(written).toHaveLength(452);
    expect(written[0]).toMatchObject({
      stream: "system",
      line: "Cloning lift-demo/next-hello at 3f9c2a1",
    });
    expect(written.slice(1, 451).map((entry) => entry.line)).toEqual(
      Array.from({ length: 450 }, (_, i) => `step ${i + 1}`),
    );
    expect(written.at(-1)?.line).toBe("Image built in 2m 03s");
    expect(Number.isNaN(Date.parse(written[0]?.ts ?? ""))).toBe(false);
  });

  it("scrubs every form of the secrets, and cuts lines at 8 KB", async () => {
    const id = newDeployment();
    const token = `gho_${"x".repeat(36)}`;
    const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
    const sink = createLogSink(redis, id, { log, secrets: [token, basic] });
    sink.write("build", `fatal: could not read from https://x-access-token:${token}@github.com`);
    sink.write("build", `AUTHORIZATION: basic ${basic}`);
    sink.write("build", "y".repeat(MAX_LINE_BYTES * 2));
    await sink.flush();
    const [first, second, long] = await entries(id);
    expect(first?.line).toBe("fatal: could not read from https://x-access-token:***@github.com");
    expect(second?.line).toBe("AUTHORIZATION: basic ***");
    expect(Buffer.byteLength(long?.line ?? "")).toBeLessThan(MAX_LINE_BYTES + 100);
    expect((long?.line ?? "").endsWith("(cut at 8 KB)")).toBe(true);
  });

  it("leaves short strings alone, so a short secret can't blank every line", () => {
    expect(scrub("main branch", ["main"])).toBe("main branch");
  });
});
