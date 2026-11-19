import { z } from "zod";
import { codeForStatus, LiftApiError, LiftContractError, Problem } from "./errors";
import {
  type DeploymentLogStreamEvent,
  LAST_EVENT_ID_HEADER,
  ProjectStreamData,
  type ProjectStreamEvent,
  STREAM_PATHS,
} from "./events";
import { cursorPage, HealthResponse } from "./schemas/common";
import { type CreateDeploymentBody, Deployment, DeploymentDetail } from "./schemas/deployment";
import { isKnownProjectEvent } from "./schemas/event";
import { GithubBranch, GithubRepo } from "./schemas/github";
import { DeploymentLogEnd, LogLine, LogSnapshot } from "./schemas/logs";
import {
  type CreateProjectBody,
  ProjectDetail,
  ProjectListItem,
  type UpdateProjectBody,
} from "./schemas/project";
import { type CreateServiceBody, Service, type UpdateServiceBody } from "./schemas/service";
import { ApiToken, CreatedApiToken, type CreateTokenBody } from "./schemas/token";
import { User } from "./schemas/user";

export interface LiftClientOptions {
  /**
   * The API's base URL including `/api/v1`: `"/api/v1"` in the browser, `${LIFT_API_URL}/api/v1`
   * in the CLI and the MCP server.
   */
  baseUrl: string;
  /**
   * A `lift_pat_` token, sent as `Authorization: Bearer`. Leave it out in the browser, which signs
   * requests with the `lift_session` cookie.
   */
  token?: string;
  /**
   * A fetch to use instead of the global one: for tests, or for the agent service, which wraps
   * fetch to add `X-Lift-Act-As` to its `lift_svc_` requests.
   */
  fetch?: typeof globalThis.fetch;
}

export interface StreamOptions {
  /** Resume after this event: the `id` of the last event or snapshot line you have. */
  lastEventId?: string;
  signal?: AbortSignal;
}

type ListParams = { limit?: number; cursor?: string };
type Query = Record<string, string | number | boolean | undefined>;

const ProjectPage = cursorPage(ProjectListItem);
const ServicePage = cursorPage(Service);
const DeploymentPage = cursorPage(Deployment);
const GithubRepoPage = cursorPage(GithubRepo);
const GithubBranchPage = cursorPage(GithubBranch);
const ApiTokenPage = cursorPage(ApiToken);
/** A problem body whose `code` this version doesn't know: keep its text, take the code from the status. */
const PartialProblem = z.object({
  type: z.string().optional(),
  title: z.string(),
  detail: z.string().optional(),
  fields: z.record(z.string(), z.string()).optional(),
});

const segment = encodeURIComponent;
const listQuery = (params: ListParams): Query => ({ limit: params.limit, cursor: params.cursor });

/**
 * The typed client for the public API: methods for the routes BE-01 to BE-08 and BE-14 serve. Every response
 * is checked against its schema; an error response throws `LiftApiError`, a response that breaks
 * the contract throws `LiftContractError`, and network failures come through as fetch throws them.
 * Later routes get methods as they ship (an additive change).
 */
export function createLiftClient(options: LiftClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetcher: typeof globalThis.fetch =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  function url(path: string, query?: Query): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) params.set(key, String(value));
    }
    const search = params.toString();
    return `${baseUrl}${path}${search ? `?${search}` : ""}`;
  }

  function headers(extra: Record<string, string>): Record<string, string> {
    return options.token ? { ...extra, Authorization: `Bearer ${options.token}` } : extra;
  }

  async function send(method: string, path: string, init: { query?: Query; body?: unknown }) {
    const hasBody = init.body !== undefined;
    const response = await fetcher(url(path, init.query), {
      method,
      headers: headers(
        hasBody
          ? { Accept: "application/json", "Content-Type": "application/json" }
          : { Accept: "application/json" },
      ),
      body: hasBody ? JSON.stringify(init.body) : undefined,
    });
    if (!response.ok) throw await errorFrom(response);
    return response;
  }

  async function call<S extends z.ZodType>(
    method: string,
    path: string,
    schema: S,
    init: { query?: Query; body?: unknown } = {},
  ): Promise<z.output<S>> {
    const response = await send(method, path, init);
    return check(schema, await response.text(), method, path, response.status);
  }

  async function callVoid(method: string, path: string, init: { body?: unknown } = {}) {
    const response = await send(method, path, init);
    await response.body?.cancel();
  }

  async function* stream(path: string, options: StreamOptions = {}) {
    const requestHeaders = headers({ Accept: "text/event-stream" });
    if (options.lastEventId) requestHeaders[LAST_EVENT_ID_HEADER] = options.lastEventId;
    const response = await fetcher(url(path), {
      method: "GET",
      headers: requestHeaders,
      signal: options.signal,
    });
    if (!response.ok) throw await errorFrom(response);
    if (!response.body) {
      throw new LiftContractError(
        "GET",
        path,
        response.status,
        new Error("The stream has no body"),
      );
    }
    yield* readSse(response.body);
  }

  async function* streamDeploymentLogs(
    deploymentId: string,
    options?: StreamOptions,
  ): AsyncGenerator<DeploymentLogStreamEvent> {
    const path = STREAM_PATHS.deploymentLogs(segment(deploymentId));
    for await (const message of stream(path, options)) {
      if (message.event === "log") {
        yield { id: message.id, event: "log", data: check(LogLine, message.data, "GET", path) };
      } else if (message.event === "end") {
        yield {
          id: message.id,
          event: "end",
          data: check(DeploymentLogEnd, message.data, "GET", path),
        };
      }
    }
  }

  async function* streamProjectEvents(
    projectId: string,
    options?: StreamOptions,
  ): AsyncGenerator<ProjectStreamEvent> {
    const path = STREAM_PATHS.projectEvents(segment(projectId));
    for await (const message of stream(path, options)) {
      const event = check(ProjectStreamData, message.data, "GET", path);
      if (isKnownProjectEvent(event)) yield { id: message.id, event: event.type, data: event };
    }
  }

  return {
    /** `GET /health` (public). */
    health: () => call("GET", "/health", HealthResponse),
    /** `GET /me`. */
    me: () => call("GET", "/me", User),
    /** `POST /auth/logout`. */
    logout: () => callVoid("POST", "/auth/logout"),

    github: {
      /** `GET /github/repos?query=`. */
      repos: (params: { query?: string } & ListParams = {}) =>
        call("GET", "/github/repos", GithubRepoPage, {
          query: { query: params.query, ...listQuery(params) },
        }),
      /** `GET /github/repos/:owner/:repo/branches`. */
      branches: (owner: string, repo: string, params: ListParams = {}) =>
        call("GET", `/github/repos/${segment(owner)}/${segment(repo)}/branches`, GithubBranchPage, {
          query: listQuery(params),
        }),
    },

    projects: {
      list: (params: ListParams = {}) =>
        call("GET", "/projects", ProjectPage, { query: listQuery(params) }),
      create: (body: z.input<typeof CreateProjectBody>) =>
        call("POST", "/projects", ProjectDetail, { body }),
      get: (projectId: string) => call("GET", `/projects/${segment(projectId)}`, ProjectDetail),
      update: (projectId: string, body: z.input<typeof UpdateProjectBody>) =>
        call("PATCH", `/projects/${segment(projectId)}`, ProjectDetail, { body }),
      delete: (projectId: string) => callVoid("DELETE", `/projects/${segment(projectId)}`),
      /** `GET /projects/:id/events/stream`: known events only; resume with `lastEventId`. */
      streamEvents: (projectId: string, options?: StreamOptions) =>
        streamProjectEvents(projectId, options),
    },

    services: {
      list: (projectId: string, params: ListParams = {}) =>
        call("GET", `/projects/${segment(projectId)}/services`, ServicePage, {
          query: listQuery(params),
        }),
      create: (projectId: string, body: z.input<typeof CreateServiceBody>) =>
        call("POST", `/projects/${segment(projectId)}/services`, Service, { body }),
      get: (serviceId: string) => call("GET", `/services/${segment(serviceId)}`, Service),
      update: (serviceId: string, body: z.input<typeof UpdateServiceBody>) =>
        call("PATCH", `/services/${segment(serviceId)}`, Service, { body }),
      delete: (serviceId: string) => callVoid("DELETE", `/services/${segment(serviceId)}`),
    },

    deployments: {
      list: (serviceId: string, params: ListParams = {}) =>
        call("GET", `/services/${segment(serviceId)}/deployments`, DeploymentPage, {
          query: listQuery(params),
        }),
      /** `POST /services/:id/deployments` → 202 with the queued deployment. */
      create: (serviceId: string, body: z.input<typeof CreateDeploymentBody> = {}) =>
        call("POST", `/services/${segment(serviceId)}/deployments`, Deployment, { body }),
      get: (deploymentId: string) =>
        call("GET", `/deployments/${segment(deploymentId)}`, DeploymentDetail),
      /** `GET /deployments/:id/logs?tail=`: the snapshot, oldest line first. */
      logs: (deploymentId: string, params: { tail?: number } = {}) =>
        call("GET", `/deployments/${segment(deploymentId)}/logs`, LogSnapshot, {
          query: { tail: params.tail },
        }),
      /** `GET /deployments/:id/logs/stream`: `log` events, then one `end`. */
      streamLogs: (deploymentId: string, options?: StreamOptions) =>
        streamDeploymentLogs(deploymentId, options),
    },

    /** BE-14: your personal tokens (`lift_pat_…`). */
    tokens: {
      /** `GET /tokens`: newest first, revoked ones included; never a token's plaintext. */
      list: (params: ListParams = {}) =>
        call("GET", "/tokens", ApiTokenPage, { query: listQuery(params) }),
      /** `POST /tokens`: the answer is the only place the token's plaintext ever appears. */
      create: (body: z.input<typeof CreateTokenBody>) =>
        call("POST", "/tokens", CreatedApiToken, { body }),
      /** `DELETE /tokens/:id`: the token stops working at once. */
      revoke: (tokenId: string) => callVoid("DELETE", `/tokens/${segment(tokenId)}`),
    },

    /** Absolute URLs for things the browser opens itself: EventSource, the sign-in redirect. */
    urls: {
      githubSignIn: (next?: string) => url("/auth/github/start", { next }),
      deploymentLogStream: (deploymentId: string) =>
        url(STREAM_PATHS.deploymentLogs(segment(deploymentId))),
      projectEventStream: (projectId: string) =>
        url(STREAM_PATHS.projectEvents(segment(projectId))),
    },
  };
}

export type LiftClient = ReturnType<typeof createLiftClient>;

/** Parses `text` as JSON and checks it, throwing LiftContractError on any mismatch. */
function check<S extends z.ZodType>(
  schema: S,
  text: string,
  method: string,
  path: string,
  status = 200,
): z.output<S> {
  let body: unknown;
  try {
    body = text === "" ? undefined : JSON.parse(text);
  } catch (error) {
    throw new LiftContractError(method, path, status, error);
  }
  const result = schema.safeParse(body);
  if (!result.success) throw new LiftContractError(method, path, status, result.error);
  return result.data;
}

/** Builds a LiftApiError from an error response, problem+json or not. */
async function errorFrom(response: Response): Promise<LiftApiError> {
  const text = await response.text().catch(() => "");
  let body: unknown;
  try {
    body = text === "" ? undefined : JSON.parse(text);
  } catch {
    body = undefined;
  }
  const problem = Problem.safeParse(body);
  if (problem.success) return new LiftApiError(problem.data);

  const partial = PartialProblem.safeParse(body);
  if (partial.success) {
    const { type, title, detail, fields } = partial.data;
    return new LiftApiError({
      type: type ?? "about:blank",
      title,
      status: response.status,
      detail: detail ?? title,
      code: codeForStatus(response.status),
      ...(fields ? { fields } : {}),
    });
  }
  return LiftApiError.fromStatus(response.status, response.statusText);
}

/** One Server-Sent Event. `id` is the last ID the stream set, as EventSource reports it. */
export interface SseMessage {
  id: string | null;
  event: string;
  data: string;
}

/**
 * Reads a `text/event-stream` body (the WHATWG format: `event:`, `data:`, `id:`, comment lines
 * starting with `:`). Works over fetch in Node and the browser, unlike EventSource, which can't
 * send an Authorization header.
 */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastEventId: string | null = null;
  let eventName = "";
  let data: string[] = [];
  let finished = false;
  try {
    while (!finished) {
      const chunk = await reader.read();
      finished = chunk.done;
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const raw = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        if (line === "") {
          if (data.length > 0) {
            yield { id: lastEventId, event: eventName || "message", data: data.join("\n") };
          }
          eventName = "";
          data = [];
        } else if (!line.startsWith(":")) {
          const colon = line.indexOf(":");
          const field = colon === -1 ? line : line.slice(0, colon);
          const rawValue = colon === -1 ? "" : line.slice(colon + 1);
          const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
          if (field === "event") eventName = value;
          else if (field === "data") data.push(value);
          else if (field === "id" && !value.includes("\0")) lastEventId = value;
        }
        newline = buffer.indexOf("\n");
      }
    }
  } finally {
    // Stopping early (break, an error) closes the connection.
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
