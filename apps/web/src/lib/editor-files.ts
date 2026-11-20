import { EDITOR_LIMITS, type EditorTree, PresenceUser } from "@lift/shared";

export type TreeFile = EditorTree["files"][number];

/** Why the editor won't open a file, from the tree alone; null when it will try. */
export type FileProblem = "binary" | "too-large";

export function fileProblem(file: TreeFile): FileProblem | null {
  if (file.binary) return "binary";
  if (file.size > EDITOR_LIMITS.maxTextFileBytes) return "too-large";
  return null;
}

export interface TreeNode {
  name: string;
  /** The repo path, which is what sessions take. */
  path: string;
  /** Set for a file; a folder has `children` instead. */
  file?: TreeFile;
  children?: TreeNode[];
}

/** The files under `rootDir` (`.` is the whole repo) as folders: folders first, then by name. */
export function buildFileTree(files: TreeFile[], rootDir: string): TreeNode[] {
  const prefix = rootDir === "." ? "" : `${rootDir}/`;
  const root: TreeNode = { name: "", path: rootDir, children: [] };
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    const parts = file.path.slice(prefix.length).split("/");
    let folder = root;
    for (const [index, name] of parts.entries()) {
      const path = prefix + parts.slice(0, index + 1).join("/");
      const children = folder.children ?? [];
      if (index === parts.length - 1) {
        children.push({ name, path, file });
        break;
      }
      let next = children.find((child) => child.children && child.name === name);
      if (!next) {
        next = { name, path, children: [] };
        children.push(next);
      }
      folder = next;
    }
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => Number(!a.children) - Number(!b.children) || a.name.localeCompare(b.name));
    for (const node of nodes) if (node.children) sort(node.children);
  };
  sort(root.children ?? []);
  return root.children ?? [];
}

/** The last part of a path. */
export const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** One awareness state as the provider reports it. */
export type AwarenessState = { clientId: number; [key: string | number]: unknown };

export interface Person {
  user: PresenceUser;
  self: boolean;
}

/**
 * Who has a document open, from its awareness states: you first, then everyone else, once each.
 * Other people's states come from their browsers, so anything that isn't a valid presence user
 * is ignored.
 */
export function peopleIn(states: AwarenessState[], selfClientId: number): Person[] {
  const people = new Map<string, Person>();
  const ordered = [...states].sort(
    (a, b) => Number(b.clientId === selfClientId) - Number(a.clientId === selfClientId),
  );
  for (const state of ordered) {
    const parsed = PresenceUser.safeParse(state.user);
    if (!parsed.success || people.has(parsed.data.id)) continue;
    people.set(parsed.data.id, { user: parsed.data, self: state.clientId === selfClientId });
  }
  return [...people.values()];
}

/** Everyone else's valid states, by connection: each gets its own cursor. */
export function othersIn(
  states: AwarenessState[],
  selfClientId: number,
): { clientId: number; user: PresenceUser }[] {
  return states.flatMap((state) => {
    if (state.clientId === selfClientId || !Number.isInteger(state.clientId)) return [];
    const parsed = PresenceUser.safeParse(state.user);
    return parsed.success ? [{ clientId: state.clientId, user: parsed.data }] : [];
  });
}

/** A CSS string: quotes and backslashes escaped, line breaks dropped. */
const cssString = (value: string) =>
  `"${value
    .slice(0, 40)
    .replace(/[\\"]/g, "\\$&")
    .replace(/[\n\r\f]/g, " ")}"`;

/**
 * Colours and name flags for other people's cursors and selections, on y-monaco's class names.
 * Colours are checked by PresenceUser (`#rrggbb`) and names are escaped, because they come from
 * other browsers.
 */
export function cursorCss(others: { clientId: number; user: PresenceUser }[]): string {
  return others
    .map(({ clientId, user }) =>
      [
        `.yRemoteSelection-${clientId} { background-color: ${user.color}40; }`,
        `.yRemoteSelectionHead-${clientId} { border-color: ${user.color}; }`,
        `.yRemoteSelectionHead-${clientId}::after { content: ${cssString(user.name)}; background-color: ${user.color}; }`,
      ].join("\n"),
    )
    .join("\n");
}
