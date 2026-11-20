import { EDITOR_LIMITS } from "@lift/shared";
import * as fixtures from "@lift/shared/fixtures";
import { describe, expect, it } from "vitest";
import {
  buildFileTree,
  cursorCss,
  fileProblem,
  othersIn,
  peopleIn,
  type TreeNode,
} from "@/lib/editor-files";

const ama = fixtures.editorSession.user;
const kwame = { ...ama, id: fixtures.users.editor.id, name: "Kwame Asante", color: "#38bdf8" };
const viewerId = fixtures.users.viewer.id;

const names = (nodes: TreeNode[]): unknown[] =>
  nodes.map((node) => (node.children ? { [node.name]: names(node.children) } : node.name));

describe("the editor's file tree", () => {
  it("lists folders first, then files, by name", () => {
    expect(names(buildFileTree(fixtures.editorTree.files, "."))).toEqual([
      { data: ["seed.sql"] },
      { public: ["favicon.ico", "logo.png"] },
      { src: [{ routes: ["orders.js"] }, "db.js"] },
      ".env.example",
      "package.json",
      "README.md",
      "server.js",
    ]);
  });

  it("starts at the service's root directory, keeping repo paths", () => {
    const tree = buildFileTree(fixtures.editorTree.files, "src");
    expect(names(tree)).toEqual([{ routes: ["orders.js"] }, "db.js"]);
    expect(tree[1]?.path).toBe("src/db.js");
  });

  it("knows which files the editor won't open", () => {
    const [file] = fixtures.editorTree.files;
    if (!file) throw new Error("no fixture file");
    expect(fileProblem({ ...file, binary: true })).toBe("binary");
    expect(fileProblem({ ...file, size: EDITOR_LIMITS.maxTextFileBytes + 1 })).toBe("too-large");
    expect(fileProblem({ ...file, size: EDITOR_LIMITS.maxTextFileBytes })).toBeNull();
  });
});

describe("presence", () => {
  const states = [
    { clientId: 7, user: kwame },
    { clientId: 3, user: ama },
    // Kwame again, in a second browser tab.
    { clientId: 9, user: kwame },
    // Another browser's state is untrusted: these are ignored.
    { clientId: 11, user: { ...kwame, id: viewerId, color: "red; } body { display: none" } },
    { clientId: 12, user: "Mallory" },
    { clientId: 13 },
  ];

  it("lists you first, then everyone else once, ignoring states that aren't valid", () => {
    expect(peopleIn(states, 3)).toEqual([
      { user: ama, self: true },
      { user: kwame, self: false },
    ]);
  });

  it("gives every other connection its own cursor", () => {
    expect(othersIn(states, 3).map((entry) => entry.clientId)).toEqual([7, 9]);
  });

  it("colours each cursor and flags it with the name, escaped", () => {
    const css = cursorCss([
      { clientId: 7, user: { ...kwame, name: 'Kwame "K" \\ Asante\n} body { display: none' } },
    ]);
    expect(css).toContain(".yRemoteSelection-7 { background-color: #38bdf840; }");
    expect(css).toContain(".yRemoteSelectionHead-7 { border-color: #38bdf8; }");
    // Cut to 40 characters, quotes and backslashes escaped, the line break gone: still one string.
    expect(css).toContain(
      'content: "Kwame \\"K\\" \\\\ Asante } body { display: non"; background-color: #38bdf8; }',
    );
  });
});
