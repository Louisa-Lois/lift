import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { problem } from "../lib/problem";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Traefik adds these to everything it forwards; the worker calls the API directly. */
function cameThroughProxy(request: FastifyRequest): boolean {
  return Object.keys(request.headers).some(
    (name) => name.startsWith("x-forwarded-") || name === "forwarded" || name === "x-real-ip",
  );
}

/**
 * Guards the internal routes registered in the same plugin scope (docs/contracts.md, "Worker
 * jobs"). A request that came through a proxy gets the same 404 as an unknown route, so the
 * public router can never reach them, even by a mistaken rule. Anything else needs
 * `Authorization: Bearer {token}`, compared in constant time.
 */
export function requireBearer(app: FastifyInstance, token: string | undefined, name: string) {
  const expected = token ? digest(token) : null;
  app.addHook("onRequest", async (request) => {
    if (cameThroughProxy(request)) {
      throw problem("not_found", `No route for ${request.method} ${request.url.split("?")[0]}.`);
    }
    if (!expected) {
      throw problem("upstream_unavailable", `${name} isn't set on this server.`);
    }
    const header = request.headers.authorization ?? "";
    const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!given || !timingSafeEqual(digest(given), expected)) {
      throw problem("unauthenticated", `Send Authorization: Bearer with the ${name}.`);
    }
  });
}
