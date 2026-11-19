import { type LogStream, REDIS_STREAMS } from "@lift/shared";
import type { Redis } from "ioredis";
import type { Logger } from "./logger";

/** Longer lines are cut, so one minified bundle can't flood the stream. */
export const MAX_LINE_BYTES = 8 * 1024;
const FLUSH_MS = 100;
const MAX_BATCH = 200;

export interface LogSink {
  /** Queues one line; it reaches Redis within 100 ms. */
  write(stream: LogStream, line: string): void;
  /** Shorthand for the worker's own step lines ("Cloning…", "Image built in…"). */
  system(line: string): void;
  /** Sends everything queued. Call it before every status report, so lines precede the end. */
  flush(): Promise<void>;
}

/** Replaces each secret (a clone token, its Basic-auth form…) with ***, wherever it appears. */
export function scrub(line: string, secrets: readonly string[]): string {
  let clean = line;
  for (const secret of secrets) {
    if (secret.length >= 8) clean = clean.split(secret).join("***");
  }
  return clean;
}

export function capLine(line: string): string {
  if (Buffer.byteLength(line) <= MAX_LINE_BYTES) return line;
  const cut = Buffer.from(line).subarray(0, MAX_LINE_BYTES).toString("utf8").replace(/�$/, "");
  return `${cut} … (cut at 8 KB)`;
}

/**
 * Writes a deployment's lines to `logs:dep:{deploymentId}` (fields `ts`, `stream`, `line`, about
 * 5,000 entries kept) in batches, in order. Every line is scrubbed of `secrets` and capped at
 * 8 KB first. Redis trouble is logged, never thrown: logs must not fail a build.
 */
export function createLogSink(
  redis: Redis,
  deploymentId: string,
  options: { secrets?: readonly string[]; log: Logger },
): LogSink {
  const stream = REDIS_STREAMS.deploymentLogs;
  const key = stream.key(deploymentId);
  const secrets = options.secrets ?? [];
  let queue: { ts: string; stream: LogStream; line: string }[] = [];
  let timer: NodeJS.Timeout | undefined;
  let sending: Promise<void> = Promise.resolve();

  function send(): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const batch = queue;
    queue = [];
    if (batch.length === 0) return sending;
    // Chained, so batches land in the order they were written.
    sending = sending.then(async () => {
      const pipeline = redis.pipeline();
      for (const entry of batch) {
        pipeline.xadd(
          key,
          "MAXLEN",
          "~",
          String(stream.maxLength),
          "*",
          "ts",
          entry.ts,
          "stream",
          entry.stream,
          "line",
          entry.line,
        );
      }
      try {
        await pipeline.exec();
      } catch (error) {
        options.log.warn({ err: error, deploymentId }, "couldn't write log lines");
      }
    });
    return sending;
  }

  function write(source: LogStream, line: string): void {
    queue.push({
      ts: new Date().toISOString(),
      stream: source,
      line: capLine(scrub(line, secrets)),
    });
    if (queue.length >= MAX_BATCH) void send();
    else timer ??= setTimeout(() => void send(), FLUSH_MS);
  }

  return { write, system: (line) => write("system", line), flush: send };
}
