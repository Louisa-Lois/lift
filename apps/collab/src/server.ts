import { Database } from "@hocuspocus/extension-database";
import { Server } from "@hocuspocus/server";
import type { Db } from "@lift/db";
import { parseEditorDocumentName } from "@lift/shared";
import { verifyCollabToken } from "@lift/shared/collab-token";
import { documentStore } from "./documents";
import type { Env } from "./env";
import { handleInternal } from "./internal";

export interface CollabOptions {
  /** How long Hocuspocus waits after an edit before saving, and at most (PRD 01: 2 s and 10 s). */
  debounce?: number;
  maxDebounce?: number;
  /** Runs when the server stops, after every document is saved. */
  onDestroy?: () => Promise<void>;
}

/**
 * The live editor's Hocuspocus server (BE-17, docs/prd/01-backend-api.md, "Live editor back end"):
 * - **who may connect:** whoever has a collab token from the API (an HS256 JWT signed with
 *   COLLAB_SECRET) for exactly this document. A viewer's connection is read-only, so the
 *   server drops their edits;
 * - **where documents live:** `editor_documents.yjs_state`. The API creates each row, with its
 *   base SHA, when the file is first opened; this server loads it and saves edits back;
 * - **the API's internal routes** (internal.ts) read and reset live documents.
 */
export function createCollabServer(
  env: Pick<Env, "HOST" | "COLLAB_PORT" | "COLLAB_SECRET">,
  db: Db,
  options: CollabOptions = {},
): Server {
  return new Server({
    address: env.HOST,
    port: env.COLLAB_PORT,
    quiet: true,
    debounce: options.debounce ?? 2_000,
    maxDebounce: options.maxDebounce ?? 10_000,
    extensions: [new Database(documentStore(db))],

    async onAuthenticate({ token, documentName, connectionConfig }) {
      if (!env.COLLAB_SECRET) throw new Error("COLLAB_SECRET isn't set on this server");
      const claims = await verifyCollabToken(token, env.COLLAB_SECRET);
      const ref = parseEditorDocumentName(documentName);
      if (!claims || !ref || claims.svc !== ref.serviceId || claims.path !== ref.path) {
        throw new Error("This token isn't valid for this document");
      }
      if (claims.role === "viewer") connectionConfig.readOnly = true;
      return { user: { id: claims.sub, role: claims.role } };
    },

    async onRequest({ request, response, instance }) {
      const path = new URL(request.url ?? "/", "http://collab.local").pathname;
      // Behind Traefik the health check answers at /collab/health; locally at /health.
      if (path.endsWith("/health")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ status: "ok" }));
        // Rejecting with null tells Hocuspocus the response was handled, so it skips its own.
        return Promise.reject(null);
      }
      if (path.startsWith("/internal/")) {
        await handleInternal(instance, env.COLLAB_SECRET, path, request, response);
        return Promise.reject(null);
      }
    },

    async onDestroy() {
      await options.onDestroy?.();
    },
  });
}
