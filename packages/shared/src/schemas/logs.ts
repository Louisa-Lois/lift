import { z } from "zod";
import { DeploymentStatus, LogStream } from "../enums";
import { Timestamp } from "./common";

/** A Redis Stream entry ID, `{milliseconds}-{sequence}`; the SSE `id` and `Last-Event-ID`. */
export const StreamEntryId = z
  .string()
  .regex(/^\d+-\d+$/, "Expected a Redis Stream entry ID like 1763301900000-0");

/** One log line: the fields of a Redis Stream entry, and the SSE `log` event's data. */
export const LogLine = z.object({ ts: Timestamp, stream: LogStream, line: z.string() });
export type LogLine = z.infer<typeof LogLine>;

/** A log line with its stream entry ID, as snapshots return it. */
export const LogEntry = LogLine.extend({ id: StreamEntryId });
export type LogEntry = z.infer<typeof LogEntry>;

/**
 * `GET /deployments/:id/logs?tail=` and `GET /services/:id/logs?since=&q=&limit=`, oldest line
 * first. To go live, open the stream with `Last-Event-ID` set to the last entry's `id`.
 */
export const LogSnapshot = z.object({ data: z.array(LogEntry) });
export type LogSnapshot = z.infer<typeof LogSnapshot>;

export const LOG_SNAPSHOT_DEFAULT_LINES = 500;
export const LOG_SNAPSHOT_MAX_LINES = 5_000;

export const DeploymentLogsQuery = z.object({
  tail: z.coerce
    .number()
    .int()
    .min(1)
    .max(LOG_SNAPSHOT_MAX_LINES)
    .default(LOG_SNAPSHOT_DEFAULT_LINES),
});
export type DeploymentLogsQuery = z.infer<typeof DeploymentLogsQuery>;

/** Runtime log search: `q` matches without regard to case, over the last 20,000 lines. */
export const ServiceLogsQuery = z.object({
  since: Timestamp.optional(),
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LOG_SNAPSHOT_MAX_LINES)
    .default(LOG_SNAPSHOT_DEFAULT_LINES),
});
export type ServiceLogsQuery = z.infer<typeof ServiceLogsQuery>;

/** The deployment log stream's last event: the status the deployment ended in. */
export const DeploymentLogEnd = z.object({ status: DeploymentStatus });
export type DeploymentLogEnd = z.infer<typeof DeploymentLogEnd>;
