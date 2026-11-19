import {
  codeForStatus,
  ERROR_STATUS,
  type ErrorCode,
  LiftApiError,
  type Problem,
} from "@lift/shared";

const TITLES: Record<ErrorCode, string> = {
  unauthenticated: "Sign in required",
  forbidden: "Not allowed",
  not_found: "Not found",
  validation_failed: "Invalid request",
  conflict: "Conflict",
  rate_limited: "Too many requests",
  github_error: "GitHub request failed",
  upstream_unavailable: "Service unavailable",
  internal: "Something went wrong",
};

/**
 * The error a route throws: `throw problem("not_found", "No project prj_…")`. The error handler
 * (plugins/errors.ts) sends it as application/problem+json with its code's status.
 */
export function problem(
  code: ErrorCode,
  detail: string,
  options: { fields?: Record<string, string>; type?: string; cause?: unknown } = {},
): LiftApiError {
  return new LiftApiError(
    {
      type: options.type ?? "about:blank",
      title: TITLES[code],
      status: ERROR_STATUS[code],
      detail,
      code,
      ...(options.fields ? { fields: options.fields } : {}),
    },
    // Kept for the logs; the response never includes it.
    options.cause === undefined ? undefined : { cause: options.cause },
  );
}

/** A problem for an HTTP error that didn't come from our code (bad JSON, body too large, …). */
export function problemForStatus(status: number, detail: string): Problem {
  const safeStatus = status >= 400 && status <= 599 ? status : 500;
  const mapped = codeForStatus(safeStatus);
  // Client errors Lift has no code for (415, 413…) are still the client's: validation_failed.
  const code = mapped === "internal" && safeStatus < 500 ? "validation_failed" : mapped;
  return { type: "about:blank", title: TITLES[code], status: safeStatus, detail, code };
}
