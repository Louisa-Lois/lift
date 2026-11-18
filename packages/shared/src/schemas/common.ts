import { z } from "zod";

/** ISO 8601 UTC timestamps, as JSON carries them: `2026-11-16T14:05:00Z` (fractions allowed). */
export const Timestamp = z.iso.datetime();
export type Timestamp = z.infer<typeof Timestamp>;

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
/** Project and service slugs: 3 to 32 lowercase letters, digits and hyphens. */
export const Slug = z
  .string()
  .regex(
    SLUG_PATTERN,
    "Use 3 to 32 lowercase letters, digits and hyphens, not starting or ending with a hyphen",
  );
export type Slug = z.infer<typeof Slug>;

export const VARIABLE_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
export const VariableKey = z
  .string()
  .max(255)
  .regex(VARIABLE_KEY_PATTERN, "Use upper-case letters, digits and underscores, like DATABASE_URL");
export type VariableKey = z.infer<typeof VariableKey>;

/** Names people give projects, services and databases. */
export const ResourceName = z.string().trim().min(1).max(64);

/** A full 40-character git object ID: commits, trees and blobs. */
export const GitSha = z.string().regex(/^[0-9a-f]{40}$/, "Expected a full 40-character git SHA");
export const CommitSha = GitSha;

/** A GitHub user or organisation name. */
export const GithubLogin = z
  .string()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, "Expected a GitHub user or organisation name");
export const GithubRepoName = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,100}$/, "Expected a GitHub repository name");
export const BranchName = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[^\s~^:?*[\\]+$/, "Expected a git branch name");

export const RepoRef = z.object({ owner: GithubLogin, name: GithubRepoName });
export type RepoRef = z.infer<typeof RepoRef>;
export const RepoWithBranch = RepoRef.extend({ branch: BranchName });
export type RepoWithBranch = z.infer<typeof RepoWithBranch>;

export const Port = z.number().int().min(1).max(65_535);
export const HealthcheckPath = z.string().max(255).startsWith("/");
/** vCPUs a service may use (default 0.5). */
export const Cpu = z.number().min(0.25).max(1);
/** Memory limit in MiB (default 512). */
export const MemoryMb = z.number().int().min(128).max(1024);

const isRelativePath = (value: string) =>
  !value.startsWith("/") &&
  !value.endsWith("/") &&
  !value.includes("\\") &&
  !value.includes("\0") &&
  !value.split("/").some((segment) => segment === ".." || segment === "");

/** A directory inside the repo, relative and POSIX-style, like `apps/web`; `.` is the root. */
export const RootDir = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) => value === "." || isRelativePath(value),
    "Use a path relative to the repo root, like apps/web, or . for the root",
  );

/** A file inside the repo, relative and POSIX-style, like `app/page.tsx`. */
export const FilePath = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) => value !== "." && isRelativePath(value),
    "Use a file path relative to the repo root",
  );

/**
 * One DNS label: a service's generated subdomain, `{service-slug}-{project-slug}` plus a
 * 4-character suffix on a clash. Two long slugs can exceed the 63-character limit, so the API
 * shortens them to fit.
 */
export const Subdomain = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, "Expected a DNS label of at most 63 characters");

/** A lowercase fully qualified hostname, like `web-demo-shop.apps.localhost`. */
export const Hostname = z
  .string()
  .max(253)
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/,
    "Expected a lowercase hostname",
  );

/** A dashboard path to return to after sign-in. Only same-site paths, never `//host`. */
export const RedirectPath = z
  .string()
  .max(2048)
  .regex(/^\/(?![/\\])\S*$/, "Expected a path on this site, like /p/prj_…");

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

/** `?limit=50&cursor=…` on every list route. */
export const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  cursor: z.string().min(1).optional(),
});
export type ListQuery = z.infer<typeof ListQuery>;

/**
 * Every list route answers `{ data, nextCursor }`; `nextCursor` is null on the last page. Small
 * lists (variables, members, databases, domains, branches, editor changes) return everything at
 * once, with `nextCursor: null`.
 */
export function cursorPage<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), nextCursor: z.string().min(1).nullable() });
}
export type CursorPage<T> = { data: T[]; nextCursor: string | null };

/** `GET /health`. */
export const HealthResponse = z.object({ status: z.literal("ok") });
export type HealthResponse = z.infer<typeof HealthResponse>;
