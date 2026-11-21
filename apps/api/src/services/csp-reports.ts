import { z } from "zod";

/**
 * Content-Security-Policy violation reports from the dashboard's browsers (apps/web/src/lib/csp.ts
 * sets the policy). Browsers define both formats, not Lift:
 * - `report-uri` (Firefox, Safari) posts one report as `application/csp-report`;
 * - the Reporting API's `report-to` (Chrome, Edge) posts a batch as `application/reports+json`.
 *
 * A report is logged, never stored, and only what helps fix the policy: the directive, what was
 * blocked (a keyword, or just the origin), and the page's and script's paths without their query
 * or fragment. Never the script sample, which can hold page data, or the original policy, which
 * holds the nonce.
 */

const text = z.string().optional().catch(undefined);
const position = z.number().int().nonnegative().optional().catch(undefined);

const LegacyReport = z.object({
  "csp-report": z.object({
    "document-uri": text,
    "effective-directive": text,
    "violated-directive": text,
    "blocked-uri": text,
    "source-file": text,
    "line-number": position,
    "column-number": position,
    disposition: text,
  }),
});

const ReportBatch = z
  .array(
    z.object({
      type: text,
      body: z
        .object({
          documentURL: text,
          effectiveDirective: text,
          blockedURL: text,
          sourceFile: text,
          lineNumber: position,
          columnNumber: position,
          disposition: text,
        })
        .optional()
        .catch(undefined),
    }),
  )
  .max(100);

export interface CspViolation {
  directive: string;
  /** A keyword (`inline`, `eval`, `data`…), or the blocked URL's origin. */
  blocked: string;
  /** The page's path, without its query or fragment, with Lift's IDs shortened. */
  page?: string;
  /** The script's path, the same way. */
  source?: string;
  line?: number;
  column?: number;
  /** `report` while the policy is report-only, `enforce` once it blocks. */
  disposition?: "report" | "enforce";
}

interface Fields {
  documentUrl?: string;
  directive?: string;
  blockedUrl?: string;
  sourceFile?: string;
  line?: number;
  column?: number;
  disposition?: string;
}

/** The violations in a report body of either format; anything else is skipped. */
export function violationsOf(body: unknown): CspViolation[] {
  const legacy = LegacyReport.safeParse(body);
  if (legacy.success) {
    const report = legacy.data["csp-report"];
    return compact([
      violation({
        documentUrl: report["document-uri"],
        // Older browsers send only violated-directive, which may carry the directive's sources.
        directive: report["effective-directive"] ?? report["violated-directive"]?.split(" ")[0],
        blockedUrl: report["blocked-uri"],
        sourceFile: report["source-file"],
        line: report["line-number"],
        column: report["column-number"],
        disposition: report.disposition,
      }),
    ]);
  }
  const batch = ReportBatch.safeParse(body);
  if (!batch.success) return [];
  return compact(
    batch.data.map(({ type, body: report }) =>
      type === "csp-violation" && report
        ? violation({
            documentUrl: report.documentURL,
            directive: report.effectiveDirective,
            blockedUrl: report.blockedURL,
            sourceFile: report.sourceFile,
            line: report.lineNumber,
            column: report.columnNumber,
            disposition: report.disposition,
          })
        : null,
    ),
  );
}

const compact = (violations: (CspViolation | null)[]): CspViolation[] =>
  violations.filter((found): found is CspViolation => found !== null);

/** `chrome-extension:`, `moz-extension:`, `safari-web-extension:`… */
const EXTENSION = /^[a-z-]*extension(:|$)/i;
/** Lift's IDs: `prj_` and 24 letters and digits (docs/contracts.md). */
const LIFT_ID = /\b([a-z]+)_[a-z0-9]{24}\b/g;
const WEB_SCHEMES = new Set(["http:", "https:", "ws:", "wss:"]);
const MAX_LENGTH = 200;

function violation(fields: Fields): CspViolation | null {
  // An extension's own scripts break the page's policy too; there's nothing to fix in Lift's.
  if (EXTENSION.test(fields.blockedUrl ?? "") || EXTENSION.test(fields.sourceFile ?? "")) {
    return null;
  }
  const directive = fields.directive?.trim();
  if (!directive || !/^[a-z-]{1,40}$/.test(directive)) return null;
  return {
    directive,
    blocked: blockedOf(fields.blockedUrl),
    page: pathOf(fields.documentUrl),
    source: pathOf(fields.sourceFile),
    line: fields.line,
    column: fields.column,
    disposition:
      fields.disposition === "report" || fields.disposition === "enforce"
        ? fields.disposition
        : undefined,
  };
}

/** Browsers send keywords bare (`inline`, `eval`, `wasm-eval`), or the blocked URL. */
function blockedOf(value: string | undefined): string {
  if (!value) return "unknown";
  if (/^[a-z-]{1,40}$/.test(value)) return value;
  try {
    const url = new URL(value);
    // data: and blob: say what kind of thing it was; anything else, only where it came from.
    return WEB_SCHEMES.has(url.protocol)
      ? url.origin.slice(0, MAX_LENGTH)
      : url.protocol.slice(0, -1);
  } catch {
    return "unknown";
  }
}

/** A URL's path, without its query or fragment, with Lift's IDs shortened: `/p/prj_*`. */
function pathOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!WEB_SCHEMES.has(url.protocol)) return undefined;
    return url.pathname.replace(LIFT_ID, "$1_*").slice(0, MAX_LENGTH);
  } catch {
    return undefined;
  }
}

const BROWSERS: [name: string, version: RegExp][] = [
  ["Edge", /\bEdg(?:e|A|iOS)?\/(\d+)/],
  ["Firefox", /\b(?:Firefox|FxiOS)\/(\d+)/],
  ["Chrome", /\b(?:Chrome|CriOS)\/(\d+)/],
  ["Safari", /\bVersion\/(\d+)[^ ]* (?:Mobile\/\S+ )?Safari\//],
];

/** The browser's name and major version, `Chrome 142`; never the whole user agent. */
export function browserOf(userAgent: string | undefined): string {
  for (const [name, version] of BROWSERS) {
    const found = userAgent?.match(version);
    if (found) return `${name} ${found[1]}`;
  }
  return "other";
}

interface WarnLogger {
  warn(fields: object, message: string): void;
}

export interface CspReportLogOptions {
  /** Distinct violations logged a minute; past that, one line says the rest was dropped. */
  limit?: number;
  windowMs?: number;
}

/**
 * Logs each distinct violation once a minute, and at most `limit` a minute: the route is public,
 * and one page load can repeat a violation many times. The API runs as one process, so the counts
 * live here.
 */
export function cspReportLog({ limit = 50, windowMs = 60_000 }: CspReportLogOptions = {}) {
  let windowStart = Number.NEGATIVE_INFINITY;
  let seen = new Set<string>();
  let dropping = false;

  return {
    record(log: WarnLogger, violations: CspViolation[], browser: string): void {
      const now = Date.now();
      if (now - windowStart >= windowMs) {
        windowStart = now;
        seen = new Set();
        dropping = false;
      }
      for (const found of violations) {
        const key = [found.directive, found.blocked, found.page, found.source, found.line, browser]
          .map(String)
          .join(" ");
        if (seen.has(key)) continue;
        if (seen.size >= limit) {
          if (!dropping) {
            dropping = true;
            log.warn(
              { csp: { limit } },
              "csp violations dropped: too many different ones this minute",
            );
          }
          return;
        }
        seen.add(key);
        log.warn({ csp: { ...found, browser } }, "csp violation");
      }
    },
  };
}
