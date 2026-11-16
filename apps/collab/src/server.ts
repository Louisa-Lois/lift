import { Server } from "@hocuspocus/server";
import type { Env } from "./env";

/**
 * The live editor's Hocuspocus server (docs/prd/01-backend-api.md, "Live editor back end").
 * BE-17 replaces `onAuthenticate` with the collab-token check and adds the Database extension
 * that loads and stores each document's Yjs state. Until then every connection is refused.
 */
export function createCollabServer(env: Pick<Env, "HOST" | "COLLAB_PORT">): Server {
  return new Server({
    address: env.HOST,
    port: env.COLLAB_PORT,
    quiet: true,

    async onAuthenticate() {
      throw new Error("Collab authentication is not built yet (BE-17)");
    },

    async onRequest({ request, response }) {
      // Behind Traefik this answers at /collab/health; locally at /health.
      const path = new URL(request.url ?? "/", "http://collab.local").pathname;
      if (path.endsWith("/health")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ status: "ok" }));
        // Rejecting with null tells Hocuspocus the response was handled, so it skips its default reply.
        return Promise.reject(null);
      }
    },
  });
}
