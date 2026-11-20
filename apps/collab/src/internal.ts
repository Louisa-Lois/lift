import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Hocuspocus } from "@hocuspocus/server";
import {
  COLLAB_INTERNAL_ROUTES,
  COLLAB_TEXT_NAME,
  CollabResetBody,
  type CollabResetResponse,
  CollabTextBody,
  type CollabTextResponse,
} from "@lift/shared";
import { MissingDocumentError } from "./documents";

/** Fits 50 documents of 512 KB with room for JSON escaping. */
const MAX_BODY_BYTES = 64 * 1024 * 1024;

class BodyTooLarge extends Error {}

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Traefik adds these to everything it forwards; the API calls collab directly. */
function cameThroughProxy(request: IncomingMessage): boolean {
  return Object.keys(request.headers).some(
    (name) => name.startsWith("x-forwarded-") || name === "forwarded" || name === "x-real-ip",
  );
}

function authorized(request: IncomingMessage, secret: string | undefined): boolean {
  const header = request.headers.authorization ?? "";
  const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!secret || !given) return false;
  return timingSafeEqual(digest(given), digest(secret));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new BodyTooLarge();
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

/** Opens a document as the server, runs `use`, and closes it, which saves it at once. */
async function withDocument<T>(
  instance: Hocuspocus,
  name: string,
  use: (connection: Awaited<ReturnType<Hocuspocus["openDirectConnection"]>>) => Promise<T>,
): Promise<T | null> {
  let connection: Awaited<ReturnType<Hocuspocus["openDirectConnection"]>>;
  try {
    connection = await instance.openDirectConnection(name, { internal: true });
  } catch (error) {
    if (error instanceof MissingDocumentError) return null;
    throw error;
  }
  try {
    return await use(connection);
  } finally {
    await connection.disconnect();
  }
}

/**
 * The live documents, for the API's commit, discard and changes (docs/prd/01-backend-api.md).
 * Each document goes through a direct connection, which loads it if nobody has it open:
 * - `text` answers each document's current text, edits not yet saved included. A document
 *   with no row answers null;
 * - `reset` replaces each document's text, which everyone editing it sees at once.
 *
 * Closing the connection saves the document at once, so the database matches what the API got.
 * The routes need `Authorization: Bearer {COLLAB_SECRET}`, and answer 404 to anything Traefik
 * forwarded. They never throw: Hocuspocus rethrows a request hook's error, which would crash the
 * process.
 */
export async function handleInternal(
  instance: Hocuspocus,
  secret: string | undefined,
  path: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    if (cameThroughProxy(request)) return send(response, 404, { error: "Not found" });
    if (path !== COLLAB_INTERNAL_ROUTES.text && path !== COLLAB_INTERNAL_ROUTES.reset) {
      return send(response, 404, { error: "Not found" });
    }
    if (request.method !== "POST") return send(response, 405, { error: "Use POST" });
    if (!authorized(request, secret)) {
      return send(response, 401, { error: "Send Authorization: Bearer with COLLAB_SECRET" });
    }
    let body: unknown;
    try {
      body = await readJson(request);
    } catch (error) {
      if (error instanceof BodyTooLarge) return send(response, 413, { error: "Body too large" });
      return send(response, 400, { error: "Send a JSON body" });
    }

    if (path === COLLAB_INTERNAL_ROUTES.text) {
      const parsed = CollabTextBody.safeParse(body);
      if (!parsed.success) return send(response, 400, { error: "Send { names: [...] }" });
      const texts: CollabTextResponse["texts"] = {};
      for (const name of parsed.data.names) {
        texts[name] = await withDocument(instance, name, async (connection) =>
          (connection.document?.getText(COLLAB_TEXT_NAME) ?? "").toString(),
        );
      }
      return send(response, 200, { texts } satisfies CollabTextResponse);
    }

    const parsed = CollabResetBody.safeParse(body);
    if (!parsed.success) {
      return send(response, 400, { error: "Send { documents: [{ name, text }] }" });
    }
    const reset: string[] = [];
    const missing: string[] = [];
    for (const { name, text } of parsed.data.documents) {
      const done = await withDocument(instance, name, async (connection) => {
        await connection.transact((document) => {
          const content = document.getText(COLLAB_TEXT_NAME);
          content.delete(0, content.length);
          content.insert(0, text);
        });
        return true;
      });
      (done ? reset : missing).push(name);
    }
    return send(response, 200, { reset, missing } satisfies CollabResetResponse);
  } catch (error) {
    console.error("internal collab route failed", error);
    if (!response.headersSent) send(response, 500, { error: "The collab server failed" });
    else response.end();
  }
}
