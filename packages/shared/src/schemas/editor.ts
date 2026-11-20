import { z } from "zod";
import { ProjectRole } from "../enums";
import { DeploymentId, EditorCommitId, EditorDocumentId, isId, ServiceId, UserId } from "../ids";
import { CommitSha, FilePath, GitSha, Timestamp } from "./common";

/** Limits from docs/prd/01-backend-api.md, "Live editor back end". */
export const EDITOR_LIMITS = {
  maxTextFileBytes: 512 * 1024,
  maxOpenDocumentsPerService: 50,
} as const;

/** The shared Yjs type: `ydoc.getText("content")`. */
export const COLLAB_TEXT_NAME = "content";

/** The Hocuspocus document name: `{serviceId}:{path}`, with the path URL-encoded. */
export function editorDocumentName(serviceId: string, path: string): string {
  return `${serviceId}:${encodeURIComponent(path)}`;
}

export function parseEditorDocumentName(name: string): { serviceId: string; path: string } | null {
  const colon = name.indexOf(":");
  const serviceId = name.slice(0, colon);
  if (colon === -1 || !isId("svc", serviceId)) return null;
  try {
    return { serviceId, path: decodeURIComponent(name.slice(colon + 1)) };
  } catch {
    return null;
  }
}

/** Cursor colours, readable on the dark theme. A user always gets the same one. */
export const PRESENCE_COLORS = [
  "#f87171",
  "#fb923c",
  "#facc15",
  "#a3e635",
  "#4ade80",
  "#2dd4bf",
  "#38bdf8",
  "#818cf8",
  "#c084fc",
  "#f472b6",
] as const;

/** The presence colour for a user: FNV-1a of the ID, so the API and collab server agree. */
export function presenceColor(userId: string): (typeof PRESENCE_COLORS)[number] {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length] ?? PRESENCE_COLORS[0];
}

/** A file's live draft. The Yjs state itself never leaves the server as JSON. */
export const EditorDocument = z.object({
  id: EditorDocumentId,
  serviceId: ServiceId,
  path: FilePath,
  baseSha: GitSha,
  updatedAt: Timestamp,
  createdAt: Timestamp,
});
export type EditorDocument = z.infer<typeof EditorDocument>;

/** A commit made from the editor; what the `editor.committed` event carries. */
export const EditorCommit = z.object({
  id: EditorCommitId,
  serviceId: ServiceId,
  commitSha: CommitSha,
  message: z.string(),
  paths: z.array(FilePath),
  authorUserId: UserId,
  deploymentId: DeploymentId.nullable(),
  createdAt: Timestamp,
});
export type EditorCommit = z.infer<typeof EditorCommit>;

export const EditorTreeQuery = z.object({ ref: z.string().min(1).max(255).optional() });
export type EditorTreeQuery = z.infer<typeof EditorTreeQuery>;

/** `GET /services/:id/editor/tree?ref=`. Binary files are read-only, so the tree marks them. */
export const EditorTree = z.object({
  sha: GitSha,
  truncated: z.boolean(),
  files: z.array(z.object({ path: FilePath, size: z.number().int().min(0), binary: z.boolean() })),
});
export type EditorTree = z.infer<typeof EditorTree>;

/** `POST /services/:id/editor/session`. */
export const EditorSessionBody = z.strictObject({ path: FilePath });
export type EditorSessionBody = z.infer<typeof EditorSessionBody>;

/** Who you are to other editors: set as the local awareness user. */
export const PresenceUser = z.object({
  id: UserId,
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9a-f]{6}$/),
  avatarUrl: z.url(),
});
export type PresenceUser = z.infer<typeof PresenceUser>;

/**
 * Connect a `HocuspocusProvider` with `name: documentName` and `token`. Viewers get
 * `readOnly: true`. The token lasts 10 minutes.
 */
export const EditorSession = z.object({
  documentName: z.string().min(1),
  token: z.string().min(1),
  baseSha: GitSha,
  readOnly: z.boolean(),
  user: PresenceUser,
});
export type EditorSession = z.infer<typeof EditorSession>;

/** The collab token's claims: an HS256 JWT signed with COLLAB_SECRET. */
export const CollabTokenClaims = z.object({
  sub: UserId,
  svc: ServiceId,
  path: FilePath,
  role: ProjectRole,
  exp: z.number().int(),
});
export type CollabTokenClaims = z.infer<typeof CollabTokenClaims>;

/**
 * `POST /services/:id/editor/commit`. On a 409 `conflict`, the problem's `fields` has a key for
 * each file that changed upstream since it was opened.
 */
export const EditorCommitBody = z.strictObject({
  message: z.string().trim().min(1).max(500),
  paths: z.array(FilePath).min(1).optional(),
});
export type EditorCommitBody = z.infer<typeof EditorCommitBody>;

export const EditorCommitResponse = z.object({ commitSha: CommitSha, deploymentId: DeploymentId });
export type EditorCommitResponse = z.infer<typeof EditorCommitResponse>;

/** `POST /services/:id/editor/discard`: resets drafts (all of them without `paths`). */
export const EditorDiscardBody = z.strictObject({ paths: z.array(FilePath).min(1).optional() });
export type EditorDiscardBody = z.infer<typeof EditorDiscardBody>;

export const EditorDiscardResponse = z.object({ paths: z.array(FilePath) });
export type EditorDiscardResponse = z.infer<typeof EditorDiscardResponse>;

// ── The collab server's internal routes ───────────────────────────────────────────────────────
// Only the API calls them, on the internal network, with `Authorization: Bearer {COLLAB_SECRET}`.
// The collab server holds the live text of every open document (the database copy lags by up to
// 10 s), so the API reads and resets drafts through it.

export const COLLAB_INTERNAL_ROUTES = {
  text: "/internal/documents/text",
  reset: "/internal/documents/reset",
} as const;

const CollabDocumentNames = z
  .array(z.string().min(1))
  .min(1)
  .max(EDITOR_LIMITS.maxOpenDocumentsPerService);

/** `POST /internal/documents/text`. */
export const CollabTextBody = z.strictObject({ names: CollabDocumentNames });
export type CollabTextBody = z.infer<typeof CollabTextBody>;

/** Each document's live text, unsaved edits included; null for a name with no document row. */
export const CollabTextResponse = z.object({ texts: z.record(z.string(), z.string().nullable()) });
export type CollabTextResponse = z.infer<typeof CollabTextResponse>;

/** `POST /internal/documents/reset`: replaces each document's text for everyone editing it. */
export const CollabResetBody = z.strictObject({
  documents: z
    .array(
      z.strictObject({
        name: z.string().min(1),
        text: z.string().max(EDITOR_LIMITS.maxTextFileBytes),
      }),
    )
    .min(1)
    .max(EDITOR_LIMITS.maxOpenDocumentsPerService),
});
export type CollabResetBody = z.infer<typeof CollabResetBody>;

/** `missing`: names with no document row, which nothing was done to. */
export const CollabResetResponse = z.object({
  reset: z.array(z.string()),
  missing: z.array(z.string()),
});
export type CollabResetResponse = z.infer<typeof CollabResetResponse>;
