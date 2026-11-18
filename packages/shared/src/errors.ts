import { z } from "zod";

/** The stable error codes (docs/contracts.md, "API rules"). Clients branch on these, never on text. */
export const ERROR_CODES = [
  "unauthenticated",
  "forbidden",
  "not_found",
  "validation_failed",
  "conflict",
  "rate_limited",
  "github_error",
  "upstream_unavailable",
  "internal",
] as const;
export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** The HTTP status the API sends with each code. */
export const ERROR_STATUS = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 400,
  conflict: 409,
  rate_limited: 429,
  github_error: 502,
  upstream_unavailable: 503,
  internal: 500,
} as const satisfies Record<ErrorCode, number>;

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

/**
 * Every API error, sent as `application/problem+json` (RFC 9457). `fields` maps a field's dot path
 * (`repo.owner`) to its message, so forms can show errors in place. The editor's commit route also
 * uses it for a 409: each file that changed upstream is a key.
 */
export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string(),
  code: ErrorCode,
  fields: z.record(z.string(), z.string()).optional(),
});
export type Problem = z.infer<typeof Problem>;

/** The code to assume for an error response that has no problem+json body. */
export function codeForStatus(status: number): ErrorCode {
  if (status === 400 || status === 422) return "validation_failed";
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status === 502 || status === 503 || status === 504) return "upstream_unavailable";
  return "internal";
}

/** Thrown by the typed client for every error response; built from its problem+json body. */
export class LiftApiError extends Error {
  override readonly name = "LiftApiError";
  readonly status: number;
  readonly code: ErrorCode;
  readonly title: string;
  readonly detail: string;
  readonly type: string;
  readonly fields: Record<string, string> | undefined;

  constructor(problem: Problem, options?: { cause?: unknown }) {
    super(problem.detail || problem.title, options);
    this.status = problem.status;
    this.code = problem.code;
    this.title = problem.title;
    this.detail = problem.detail;
    this.type = problem.type;
    this.fields = problem.fields;
  }

  /** For an error response without a usable problem+json body, such as a proxy's HTML page. */
  static fromStatus(status: number, statusText = "", options?: { cause?: unknown }): LiftApiError {
    const title = statusText || `HTTP ${status}`;
    return new LiftApiError(
      {
        type: "about:blank",
        title,
        status: status >= 400 && status <= 599 ? status : 500,
        detail: `The API answered ${status}${statusText ? ` ${statusText}` : ""} without a problem+json body.`,
        code: codeForStatus(status),
      },
      options,
    );
  }

  toProblem(): Problem {
    const { type, title, status, detail, code, fields } = this;
    return fields
      ? { type, title, status, detail, code, fields }
      : { type, title, status, detail, code };
  }
}

export function isLiftApiError(error: unknown): error is LiftApiError {
  return error instanceof LiftApiError;
}

/**
 * Thrown by the typed client when a success response (or a stream event) doesn't match its schema
 * in this package: the API and the contracts have drifted apart.
 */
export class LiftContractError extends Error {
  override readonly name = "LiftContractError";
  readonly method: string;
  readonly path: string;
  readonly status: number;

  constructor(method: string, path: string, status: number, cause: unknown) {
    super(`${method} ${path} answered ${status} with a body that doesn't match @lift/shared.`, {
      cause,
    });
    this.method = method;
    this.path = path;
    this.status = status;
  }
}
