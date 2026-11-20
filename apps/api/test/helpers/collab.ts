import { type Db, schema } from "@lift/db";
import {
  COLLAB_INTERNAL_ROUTES,
  COLLAB_TEXT_NAME,
  CollabResetBody,
  CollabTextBody,
  parseEditorDocumentName,
} from "@lift/shared";
import { and, eq } from "drizzle-orm";
import * as Y from "yjs";

/** COLLAB_SECRET in tests. */
export const TEST_COLLAB_SECRET = "collab-".padEnd(64, "c");

const documents = schema.editorDocuments;

function rowOf(name: string) {
  const ref = parseEditorDocumentName(name);
  return ref ? and(eq(documents.serviceId, ref.serviceId), eq(documents.path, ref.path)) : null;
}

/** A document's saved text, as the collab server loads it. */
export async function savedText(db: Db, name: string): Promise<string | null> {
  const where = rowOf(name);
  if (!where) return null;
  const [row] = await db.select({ state: documents.yjsState }).from(documents).where(where);
  if (!row) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(row.state));
  return doc.getText(COLLAB_TEXT_NAME).toString();
}

/**
 * Answers the collab server's internal routes the way the real one does (apps/collab tests that
 * one): from the saved document, or from `drafts`, live text nobody's editor has saved yet.
 */
export function fakeCollab(db: Db, secret = TEST_COLLAB_SECRET) {
  const drafts = new Map<string, string>();
  const calls: { path: string; body: unknown; authorization: string | null }[] = [];

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body: unknown = await request.json();
    calls.push({ path: url.pathname, body, authorization: request.headers.get("authorization") });
    if (request.headers.get("authorization") !== `Bearer ${secret}`) {
      return Response.json(
        { error: "Send Authorization: Bearer with COLLAB_SECRET" },
        { status: 401 },
      );
    }
    if (url.pathname === COLLAB_INTERNAL_ROUTES.text) {
      const { names } = CollabTextBody.parse(body);
      const texts: Record<string, string | null> = {};
      for (const name of names) texts[name] = drafts.get(name) ?? (await savedText(db, name));
      return Response.json({ texts });
    }
    if (url.pathname === COLLAB_INTERNAL_ROUTES.reset) {
      const reset: string[] = [];
      const missing: string[] = [];
      for (const { name, text } of CollabResetBody.parse(body).documents) {
        const where = rowOf(name);
        const doc = new Y.Doc();
        doc.getText(COLLAB_TEXT_NAME).insert(0, text);
        const updated = where
          ? await db
              .update(documents)
              .set({ yjsState: Buffer.from(Y.encodeStateAsUpdate(doc)), updatedAt: new Date() })
              .where(where)
              .returning({ id: documents.id })
          : [];
        if (updated.length === 0) {
          missing.push(name);
          continue;
        }
        drafts.delete(name);
        reset.push(name);
      }
      return Response.json({ reset, missing });
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  };

  return { fetch, drafts, calls };
}
