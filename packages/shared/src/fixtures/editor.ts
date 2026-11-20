import { EditorSession, EditorTree, editorDocumentName, presenceColor } from "../schemas/editor";
import { services, users } from "./demo";
import { fixtureHex } from "./ids";

// The live editor on the demo's Express API (`lift-demo/express-postgres` at main).

/** `GET /services/:id/editor/tree`: text files, two binary ones, and one too large to edit. */
export const editorTree = EditorTree.parse({
  sha: fixtureHex("api-editor-head", 40),
  truncated: false,
  files: [
    { path: ".env.example", size: 96, binary: false },
    { path: "README.md", size: 1_284, binary: false },
    { path: "data/seed.sql", size: 734_003, binary: false },
    { path: "package.json", size: 512, binary: false },
    { path: "public/favicon.ico", size: 4_286, binary: true },
    { path: "public/logo.png", size: 18_442, binary: true },
    { path: "server.js", size: 1_140, binary: false },
    { path: "src/db.js", size: 386, binary: false },
    { path: "src/routes/orders.js", size: 1_932, binary: false },
  ],
});

/** `POST /services/:id/editor/session` for `server.js`, as the owner. Not a usable token. */
export const editorSession = EditorSession.parse({
  documentName: editorDocumentName(services.api.id, "server.js"),
  token: `fixture.${fixtureHex("collab-token", 32)}.signature`,
  baseSha: fixtureHex("api-server-js-blob", 40),
  readOnly: false,
  user: {
    id: users.owner.id,
    name: users.owner.name ?? users.owner.login,
    color: presenceColor(users.owner.id),
    avatarUrl: users.owner.avatarUrl,
  },
});
