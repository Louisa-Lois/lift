import type { LogEntry } from "@lift/shared";

/** The log viewer keeps at most this many lines; older ones drop off the top. */
export const MAX_LOG_LINES = 50_000;

/** Orders two Redis Stream entry IDs (`{ms}-{seq}`). */
export function compareEntryIds(a: string, b: string): number {
  const [aMs = 0, aSeq = 0] = a.split("-").map(Number);
  const [bMs = 0, bSeq = 0] = b.split("-").map(Number);
  return aMs - bMs || aSeq - bSeq;
}

/**
 * Appends lines in order. A line at or before the last one held is skipped, so a stream that
 * resumes (or replays from the start after an error) never shows a line twice. Keeps the newest
 * `max` lines.
 */
export function appendLines(
  lines: readonly LogEntry[],
  incoming: readonly LogEntry[],
  max: number = MAX_LOG_LINES,
): LogEntry[] {
  let lastId = lines.at(-1)?.id;
  const fresh: LogEntry[] = [];
  for (const line of incoming) {
    if (lastId !== undefined && compareEntryIds(line.id, lastId) <= 0) continue;
    fresh.push(line);
    lastId = line.id;
  }
  if (fresh.length === 0) return lines as LogEntry[];
  const next = [...lines, ...fresh];
  return next.length > max ? next.slice(next.length - max) : next;
}
