import { type NextRequest, NextResponse } from "next/server";
import { COLLAB_URL } from "@/lib/collab";
import { CSP_HEADER, contentSecurityPolicy, newNonce, REPORTING_ENDPOINTS } from "@/lib/csp";

/**
 * Every page's Content-Security-Policy, with a new nonce each time (src/lib/csp.ts). The policy goes
 * on the request as well as the response: Next.js reads the nonce from the request's copy while it
 * renders the page, and stamps its scripts with it. The root layout renders every page per request
 * so that it can.
 */
export function proxy(request: NextRequest): NextResponse {
  const policy = contentSecurityPolicy({
    nonce: newNonce(),
    development: process.env.NODE_ENV === "development",
    collabUrl: COLLAB_URL,
  });
  const headers = new Headers(request.headers);
  headers.set(CSP_HEADER, policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(CSP_HEADER, policy);
  response.headers.set("Reporting-Endpoints", REPORTING_ENDPOINTS);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: not the API (which development proxies), built files, images, the mocks'
      // service worker, or link prefetches.
      source: "/((?!api|_next/static|_next/image|favicon.ico|mockServiceWorker.js).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
