import type { z } from "zod";
import type { ProjectEventType } from "./enums";
import { AnyProjectEvent, isKnownProjectEvent, type ProjectEvent } from "./schemas/event";
import { DeploymentLogEnd, LogLine } from "./schemas/logs";

/**
 * The three Server-Sent Events streams (docs/contracts.md, "Real-time events"). Every event carries
 * an `id`, its Redis Stream entry ID, so a client resumes with `Last-Event-ID`. Servers send a
 * comment line every 15 seconds as a heartbeat.
 */
export const SSE_HEARTBEAT_MS = 15_000;
export const LAST_EVENT_ID_HEADER = "Last-Event-ID";

/** Stream paths, relative to `API_BASE_PATH`. */
export const STREAM_PATHS = {
  projectEvents: (projectId: string) => `/projects/${projectId}/events/stream`,
  deploymentLogs: (deploymentId: string) => `/deployments/${deploymentId}/logs/stream`,
  serviceLogs: (serviceId: string) => `/services/${serviceId}/logs/stream`,
} as const;

/**
 * The Redis Streams behind them, capped near `maxLength` entries. Log entries have the fields
 * `ts`, `stream` and `line`, written by the worker. Project events go through a stream too (not
 * pub/sub), so they resume the same way: each entry has one field, `event`, holding the event JSON.
 */
export const REDIS_STREAMS = {
  deploymentLogs: { key: (deploymentId: string) => `logs:dep:${deploymentId}`, maxLength: 5_000 },
  serviceLogs: { key: (serviceId: string) => `logs:svc:${serviceId}`, maxLength: 20_000 },
  projectEvents: { key: (projectId: string) => `events:prj:${projectId}`, maxLength: 1_000 },
} as const;

/** Deployment logs: `log` events with build, deploy and system lines, then one `end`. */
export const DEPLOYMENT_LOG_STREAM_EVENTS = {
  log: LogLine,
  end: DeploymentLogEnd,
} as const satisfies Record<string, z.ZodType>;

/** Service logs: `log` events with runtime lines only. */
export const SERVICE_LOG_STREAM_EVENTS = { log: LogLine } as const satisfies Record<
  string,
  z.ZodType
>;

/**
 * The project stream: the SSE `event:` name is the event's `type`, and `data` is the whole event
 * (the same shape `GET /projects/:id/events` lists). Types a client doesn't know are skipped.
 */
export const ProjectStreamData = AnyProjectEvent;

export type DeploymentLogStreamEvent =
  | { id: string | null; event: "log"; data: LogLine }
  | { id: string | null; event: "end"; data: DeploymentLogEnd };
export type ServiceLogStreamEvent = { id: string | null; event: "log"; data: LogLine };
export type ProjectStreamEvent = { id: string | null; event: ProjectEventType; data: ProjectEvent };

/**
 * For EventSource users: parses one project-stream message's `data`. Returns null for a type this
 * version doesn't know, and throws (a ZodError or SyntaxError) for a malformed one.
 */
export function parseProjectStreamData(data: string): ProjectEvent | null {
  const event = ProjectStreamData.parse(JSON.parse(data));
  return isKnownProjectEvent(event) ? event : null;
}
