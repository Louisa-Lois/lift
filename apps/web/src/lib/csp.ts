import { API_BASE_PATH } from "@lift/shared";

/**
 * The dashboard's Content-Security-Policy (docs/prd/02-frontend.md, "Non-functional"). src/proxy.ts
 * sends it on every page with a new nonce. Next.js reads the nonce from the request's copy of the
 * policy and stamps its own scripts with it, so an injected inline script, which can't know the
 * nonce, doesn't run. 'strict-dynamic' lets the stamped scripts load the app's other chunks.
 *
 * Report-only for now: browsers report what it would block to the API (POST /api/v1/csp-reports)
 * and block nothing. A font, image, script or video from another site needs its host added here.
 */
export const CSP_HEADER = "Content-Security-Policy-Report-Only";
export const CSP_REPORT_PATH = `${API_BASE_PATH}/csp-reports`;
/** `report-to`'s group, which `Reporting-Endpoints` maps to the report path (Chrome and Edge). */
const REPORT_GROUP = "csp";
export const REPORTING_ENDPOINTS = `${REPORT_GROUP}="${CSP_REPORT_PATH}"`;

/**
 * Where avatars come from (the app shell, members, the editor's presence): GitHub serves
 * accounts' avatars from avatars.githubusercontent.com, and identicons, like the demo fixtures',
 * from github.com, which also redirects `{login}.png` there. presence-avatars.tsx allows the same.
 */
const AVATARS = ["https://avatars.githubusercontent.com", "https://github.com"];

export interface PolicyOptions {
  /** New for every response: see `newNonce`. */
  nonce: string;
  /** `next dev`: React's development tooling uses eval. */
  development: boolean;
  /** The collab server's WebSocket (NEXT_PUBLIC_COLLAB_URL, inlined at build time). */
  collabUrl: string;
}

export function contentSecurityPolicy({ nonce, development, collabUrl }: PolicyOptions): string {
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    // 'self' only matters to browsers that don't know 'strict-dynamic'.
    [
      "script-src",
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(development ? ["'unsafe-eval'"] : []),
    ],
    // Monaco, Radix and sonner set styles from JavaScript. A nonce can't cover a style attribute,
    // and a nonce here would switch 'unsafe-inline' off.
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "data:", ...AVATARS],
    ["font-src", "'self'"],
    // The API and its event streams are on this origin; collab is too in production, but some
    // browsers don't count wss: as 'self', and development runs it on its own port.
    ["connect-src", "'self'", ...originOf(collabUrl)],
    // Monaco's worker, which Turbopack builds as a file of its own.
    ["worker-src", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'none'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
    // report-uri for Firefox and Safari; Chrome and Edge use report-to and ignore it.
    ["report-uri", CSP_REPORT_PATH],
    ["report-to", REPORT_GROUP],
  ];
  return directives.map((directive) => directive.join(" ")).join("; ");
}

/** A URL's origin, or nothing if it isn't one: a bad build argument mustn't take every page down. */
function originOf(url: string): string[] {
  try {
    return [new URL(url).origin];
  } catch {
    return [];
  }
}

/** 16 random bytes in base64, new for every response, so a page's nonce can't be guessed. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
