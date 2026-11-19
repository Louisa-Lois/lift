import type { FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";

/** A Redis Stream entry ID, the only `Last-Event-ID` the streams accept. */
const STREAM_ID = /^\d{1,20}-\d{1,20}$/;

export interface SseConnection {
  /** Sends one event; waits while the client's buffer is full. */
  send(message: { id?: string; event: string; data: string }): Promise<void>;
  /** A comment line: the heartbeat that keeps proxies from closing an idle stream. */
  comment(text: string): void;
  /** Aborted when the client goes away. */
  readonly signal: AbortSignal;
  end(): void;
}

/**
 * Takes over the response for Server-Sent Events (docs/contracts.md, "Real-time events").
 * `no-transform` stops proxies from compressing (and so buffering) it; Next's development proxy
 * honours it. Headers go out at once, with a first comment, so the client sees the stream open.
 */
export function openSse(request: FastifyRequest, reply: FastifyReply): SseConnection {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  raw.write(": connected\n\n");
  const controller = new AbortController();
  // The response's "close" fires when the client disconnects (the request's fires too early).
  raw.on("close", () => controller.abort());
  request.log.debug("event stream opened");
  return {
    async send({ id, event, data }) {
      if (controller.signal.aborted) return;
      const idLine = id === undefined ? "" : `id: ${id}\n`;
      if (!raw.write(`${idLine}event: ${event}\ndata: ${data}\n\n`)) {
        await new Promise<void>((resolve) => {
          raw.once("drain", resolve);
          raw.once("close", resolve);
        });
      }
    },
    comment(text) {
      if (!controller.signal.aborted) raw.write(`: ${text}\n\n`);
    },
    signal: controller.signal,
    end() {
      controller.abort();
      if (!raw.writableEnded) raw.end();
    },
  };
}

/** The ID to read after: the client's `Last-Event-ID` when valid, else the stream's newest entry. */
export async function startingPoint(
  redis: Redis,
  key: string,
  lastEventId: string | string[] | undefined,
): Promise<string> {
  if (typeof lastEventId === "string" && STREAM_ID.test(lastEventId)) return lastEventId;
  // A concrete ID rather than `$`, so an entry added between two reads is never skipped.
  const [newest] = await redis.xrevrange(key, "+", "-", "COUNT", 1);
  return newest?.[0] ?? "0-0";
}

/**
 * Follows a Redis Stream on a connection of its own (XREAD BLOCK holds it), calling `onEntry`
 * for each entry after `after` until the client leaves or `onEntry` returns false. An empty
 * read sends the heartbeat.
 */
export async function followStream(
  redis: Redis,
  input: {
    key: string;
    after: string;
    sse: SseConnection;
    heartbeatMs: number;
    onEntry: (id: string, fields: Record<string, string>) => Promise<boolean>;
    /** Called after each quiet period, with the heartbeat; returning false ends the stream. */
    onIdle?: () => Promise<boolean>;
  },
): Promise<void> {
  const connection = redis.duplicate();
  const stop = () => connection.disconnect();
  input.sse.signal.addEventListener("abort", stop, { once: true });
  let cursor = input.after;
  try {
    while (!input.sse.signal.aborted) {
      const result = await connection.xread(
        "COUNT",
        100,
        "BLOCK",
        input.heartbeatMs,
        "STREAMS",
        input.key,
        cursor,
      );
      if (!result) {
        input.sse.comment("heartbeat");
        if (input.onIdle && !(await input.onIdle())) return;
        continue;
      }
      for (const [, entries] of result) {
        for (const [id, list] of entries) {
          cursor = id;
          const fields: Record<string, string> = {};
          for (let i = 0; i + 1 < list.length; i += 2)
            fields[list[i] as string] = list[i + 1] as string;
          if (!(await input.onEntry(id, fields))) return;
        }
      }
    }
  } catch (error) {
    // Disconnecting interrupts the blocked read; anything else is a real failure.
    if (!input.sse.signal.aborted) throw error;
  } finally {
    input.sse.signal.removeEventListener("abort", stop);
    connection.disconnect();
  }
}
