import { type Db, schema } from "@lift/db";
import { DeploymentStatus, type LogEntry, LogStream, REDIS_STREAMS, Timestamp } from "@lift/shared";
import { eq } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";

// A deployment's log stream, `logs:dep:{id}`: the worker appends entries with the fields `ts`,
// `stream` and `line`. When the deployment ends, the API appends one marker entry whose only
// field is `end`, holding the final status. Readers turn the marker into the SSE `end` event and
// never show it as a line. Only the API reads these streams, so the marker stays internal.

const END_FIELD = "end";
/** How long a finished deployment's stream stays in Redis; `build_logs` keeps a copy after. */
export const LOG_RETENTION_SECONDS = 7 * 24 * 60 * 60;
/** `build_logs` keeps at most this much of a log: its end, where failures show. */
export const BUILD_LOGS_MAX_BYTES = 1024 * 1024;

export type ReadEntry =
  | { kind: "line"; entry: LogEntry }
  | { kind: "end"; id: string; status: DeploymentStatus };

/** Redis returns an entry's fields as `[name, value, name, value…]`. */
export function fieldsOf(list: string[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (let i = 0; i + 1 < list.length; i += 2) fields[list[i] as string] = list[i + 1] as string;
  return fields;
}

/**
 * An entry as a log line or the end marker; null when it is neither. Lenient on purpose: a line
 * with an odd timestamp or stream name still shows, timed by its entry ID.
 */
export function readEntry(id: string, fields: Record<string, string>): ReadEntry | null {
  if (fields[END_FIELD] !== undefined) {
    const status = DeploymentStatus.safeParse(fields[END_FIELD]);
    return status.success ? { kind: "end", id, status: status.data } : null;
  }
  if (fields.line === undefined) return null;
  const ts = Timestamp.safeParse(fields.ts);
  const stream = LogStream.safeParse(fields.stream);
  return {
    kind: "line",
    entry: {
      id,
      ts: ts.success ? ts.data : new Date(Number(id.split("-")[0])).toISOString(),
      stream: stream.success ? stream.data : "system",
      line: fields.line,
    },
  };
}

/** Orders two stream entry IDs (`{ms}-{seq}`) like Redis does. */
export function compareIds(a: string, b: string): number {
  const [aMs = 0, aSeq = 0] = a.split("-").map(Number);
  const [bMs = 0, bSeq = 0] = b.split("-").map(Number);
  return aMs - bMs || aSeq - bSeq;
}

/** The copy kept in `build_logs` (NDJSON, one entry per line), oldest line first. */
export async function storedLog(db: Db, deploymentId: string): Promise<LogEntry[]> {
  const [row] = await db
    .select({ content: schema.buildLogs.content })
    .from(schema.buildLogs)
    .where(eq(schema.buildLogs.deploymentId, deploymentId));
  if (!row?.content) return [];
  return row.content.split("\n").flatMap((json) => {
    try {
      return [JSON.parse(json) as LogEntry];
    } catch {
      return [];
    }
  });
}

/**
 * `GET /deployments/:id/logs?tail=`: the last `tail` lines, oldest first, from Redis while the
 * stream lives, then from `build_logs`.
 */
export async function logSnapshot(
  deps: { db: Db; redis: Redis },
  deploymentId: string,
  tail: number,
): Promise<LogEntry[]> {
  const key = REDIS_STREAMS.deploymentLogs.key(deploymentId);
  // One extra, in case the newest entry is the end marker.
  const newest = await deps.redis.xrevrange(key, "+", "-", "COUNT", tail + 1);
  if (newest.length === 0) return (await storedLog(deps.db, deploymentId)).slice(-tail);
  return newest
    .reverse()
    .flatMap(([id, list]) => {
      const read = readEntry(id, fieldsOf(list));
      return read?.kind === "line" ? [read.entry] : [];
    })
    .slice(-tail);
}

/** The last lines whose total size fits in `maxBytes`, joined as NDJSON. */
function lastBytes(lines: string[], maxBytes: number): string {
  let size = 0;
  let start = lines.length;
  while (start > 0) {
    const next = Buffer.byteLength(lines[start - 1] as string) + 1;
    if (size + next > maxBytes) break;
    size += next;
    start -= 1;
  }
  return lines.slice(start).join("\n");
}

/**
 * When a deployment ends (active, failed or canceled): appends the end marker, so open streams
 * send `end` and close; copies the lines to `build_logs`; and lets the stream expire after 7
 * days. The worker sends its last line before its last report, so nothing follows the marker.
 * Redis trouble costs only the live `end` and the copy, never the status, which is stored.
 */
export async function finishLogs(
  deps: { db: Db; redis: Redis; log: FastifyBaseLogger },
  deploymentId: string,
  status: DeploymentStatus,
): Promise<void> {
  const stream = REDIS_STREAMS.deploymentLogs;
  const key = stream.key(deploymentId);
  try {
    await deps.redis.xadd(key, "MAXLEN", "~", String(stream.maxLength), "*", END_FIELD, status);
    const entries = await deps.redis.xrange(key, "-", "+");
    const lines = entries.flatMap(([id, list]) => {
      const read = readEntry(id, fieldsOf(list));
      return read?.kind === "line" ? [JSON.stringify(read.entry)] : [];
    });
    if (lines.length > 0) {
      const content = lastBytes(lines, BUILD_LOGS_MAX_BYTES);
      await deps.db
        .insert(schema.buildLogs)
        .values({ deploymentId, content })
        .onConflictDoUpdate({ target: schema.buildLogs.deploymentId, set: { content } });
    }
    await deps.redis.expire(key, LOG_RETENTION_SECONDS);
  } catch (error) {
    deps.log.warn({ err: error, deploymentId }, "couldn't finish a deployment's logs");
  }
}
