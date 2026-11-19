import type { FastifyServerOptions } from "fastify";

/** A path without its query string: OAuth's `?code=` and `?state=` are secrets. */
export function withoutQuery(url: string): string {
  const index = url.indexOf("?");
  return index === -1 ? url : url.slice(0, index);
}

/**
 * Pino options for the API. Nothing logs a secret (docs/prd/01-backend-api.md): credential headers
 * are redacted wherever they appear, and request URLs are logged without their query strings.
 * `stream` lets tests read what was logged.
 */
export function loggerOptions(
  level: string,
  stream?: { write(message: string): void },
): FastifyServerOptions["logger"] {
  return {
    level,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        'req.headers["x-hub-signature-256"]',
        'res.headers["set-cookie"]',
      ],
      censor: "[redacted]",
    },
    serializers: {
      req(request: { method: string; url: string; ip?: string }) {
        return { method: request.method, url: withoutQuery(request.url), ip: request.ip };
      },
    },
    ...(stream ? { stream } : {}),
  };
}
