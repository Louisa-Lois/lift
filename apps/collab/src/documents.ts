import { type Db, schema } from "@lift/db";
import { parseEditorDocumentName } from "@lift/shared";
import { and, eq, ne } from "drizzle-orm";

const documents = schema.editorDocuments;

/**
 * A document name with no `editor_documents` row. The API creates the row when someone opens the
 * file, so a connection to anything else is refused rather than given an empty document whose
 * edits could never be saved.
 */
export class MissingDocumentError extends Error {
  /** What the provider's `onAuthenticationFailed` gets as its reason. */
  readonly reason = "document-not-found";

  constructor(documentName: string) {
    super(`There's no editor document ${documentName}; the API creates it when the file is opened`);
  }
}

/** The row a document name points at: `{serviceId}:{path}`, or null for any other name. */
function rowOf(documentName: string) {
  const ref = parseEditorDocumentName(documentName);
  return ref ? and(eq(documents.serviceId, ref.serviceId), eq(documents.path, ref.path)) : null;
}

/** What the Database extension loads documents from and saves them to. */
export function documentStore(db: Db) {
  return {
    async fetch({ documentName }: { documentName: string }): Promise<Uint8Array> {
      const where = rowOf(documentName);
      const [row] = where
        ? await db.select({ state: documents.yjsState }).from(documents).where(where).limit(1)
        : [];
      if (!row) throw new MissingDocumentError(documentName);
      return new Uint8Array(row.state);
    },

    /**
     * Saves only a changed state: a direct connection saves when it closes, even one that only
     * read the text, and `updated_at` should say when the draft last changed.
     */
    async store({ documentName, state }: { documentName: string; state: Buffer }): Promise<void> {
      const where = rowOf(documentName);
      if (!where) return;
      await db
        .update(documents)
        .set({ yjsState: state, updatedAt: new Date() })
        .where(and(where, ne(documents.yjsState, state)));
    },
  };
}
