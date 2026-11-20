import { HocuspocusProvider } from "@hocuspocus/provider";
import { COLLAB_TEXT_NAME, type EditorSession, isLiftApiError } from "@lift/shared";
import { MonacoBinding } from "y-monaco";
import * as Y from "yjs";
import { api } from "@/lib/api";
import { COLLAB_URL } from "@/lib/collab";
import { type AwarenessState, othersIn, type Person, peopleIn } from "@/lib/editor-files";
import type { monaco } from "./monaco";

export type Connection = "connecting" | "connected" | "disconnected";

/** What a file's tab and the header show; each report changes only the fields it has. */
export interface LiveFileState {
  connection?: Connection;
  /** Why the file can't be edited live: the API or the collab server refused it. */
  error?: string | null;
  readOnly?: boolean;
  /** The file has Windows line endings, which the editor can't keep yet: it opens read-only. */
  crlf?: boolean;
  people?: Person[];
}

export interface LiveFile {
  readonly model: monaco.editor.ITextModel;
  readOnly: boolean;
  /** Where the cursor and scroll were, kept while another tab is on screen. */
  viewState: monaco.editor.ICodeEditorViewState | null;
  /** Everyone else's connections to this file, for their cursors. */
  others(): ReturnType<typeof othersIn>;
  dispose(): void;
}

function reasonOf(error: unknown): string {
  if (isLiftApiError(error)) return error.fields?.path ?? error.detail ?? error.title;
  return "Lift didn't answer. Check your connection, then open the file again.";
}

/**
 * One file's live document (FE-13): a session from the API, a Hocuspocus provider on the collab
 * server, and y-monaco binding its shared text to a Monaco model. The provider asks for a fresh
 * session on every connection after the first, because a collab token lasts 10 minutes.
 */
export function openLiveFile(options: {
  monaco: typeof monaco;
  serviceId: string;
  path: string;
  editor: monaco.editor.IStandaloneCodeEditor;
  onState: (state: LiveFileState) => void;
  onCursors: () => void;
}): LiveFile {
  const { monaco, serviceId, path, editor, onState, onCursors } = options;
  const doc = new Y.Doc();
  const text = doc.getText(COLLAB_TEXT_NAME);
  const model = monaco.editor.createModel(
    "",
    undefined,
    monaco.Uri.from({ scheme: "lift", path: `/${path}` }),
  );
  let provider: HocuspocusProvider | null = null;
  let binding: MonacoBinding | null = null;
  let disposed = false;
  const states = (): AwarenessState[] =>
    provider?.awareness
      ? [...provider.awareness.getStates()].map(([clientId, state]) => ({ ...state, clientId }))
      : [];

  const file: LiveFile = {
    model,
    readOnly: true,
    viewState: null,
    others: () => othersIn(states(), doc.clientID),
    dispose() {
      disposed = true;
      binding?.destroy();
      provider?.destroy();
      model.dispose();
      doc.destroy();
    },
  };

  function connect(session: EditorSession) {
    let first: string | null = session.token;
    provider = new HocuspocusProvider({
      url: COLLAB_URL,
      name: session.documentName,
      document: doc,
      token: async () => {
        const token = first;
        first = null;
        return token ?? (await api.editor.session(serviceId, { path })).token;
      },
      onStatus: ({ status }) => onState({ connection: status as Connection }),
      onSynced: () => {
        // y-monaco keeps offsets in step only with \n line endings; Monaco rewrites \r\n.
        if (!text.toString().includes("\r")) return;
        file.readOnly = true;
        onState({ crlf: true, readOnly: true });
      },
      onAuthenticationFailed: () =>
        onState({
          connection: "disconnected",
          error: "The live editor refused this file. Close it and open it again.",
        }),
      // Not the states this callback gets: the provider spreads each state over its clientId, so
      // a state from another browser could claim to be yours. `states()` keeps the real one.
      onAwarenessChange: () => {
        onState({ people: peopleIn(states(), doc.clientID) });
        onCursors();
      },
    });
    provider.setAwarenessField("user", session.user);
    binding = new MonacoBinding(text, model, new Set([editor]), provider.awareness);
    file.readOnly = session.readOnly;
    onState({ readOnly: session.readOnly });
  }

  onState({ connection: "connecting", error: null });
  api.editor.session(serviceId, { path }).then(
    (session) => {
      if (!disposed) connect(session);
    },
    (error: unknown) => {
      if (!disposed) onState({ connection: "disconnected", error: reasonOf(error) });
    },
  );
  return file;
}
