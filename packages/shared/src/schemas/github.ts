import { z } from "zod";
import {
  BranchName,
  FilePath,
  GithubLogin,
  GithubRepoName,
  GitSha,
  ListQuery,
  Timestamp,
} from "./common";

/** `GET /github/repos?query=`: repos the signed-in user can access. */
export const GithubRepo = z.object({
  owner: GithubLogin,
  name: GithubRepoName,
  private: z.boolean(),
  defaultBranch: BranchName,
  pushedAt: Timestamp.nullable(),
});
export type GithubRepo = z.infer<typeof GithubRepo>;

export const GithubReposQuery = ListQuery.extend({ query: z.string().trim().max(100).optional() });
export type GithubReposQuery = z.infer<typeof GithubReposQuery>;

/** `GET /github/repos/:owner/:repo/branches`. */
export const GithubBranch = z.object({ name: BranchName });
export type GithubBranch = z.infer<typeof GithubBranch>;

export const GITHUB_TREE_MAX_FILES = 5_000;
export const GITHUB_FILE_MAX_BYTES = 1024 * 1024;

export const GithubRefQuery = z.object({ ref: z.string().min(1).max(255).optional() });
export type GithubRefQuery = z.infer<typeof GithubRefQuery>;

/** `GET /github/repos/:owner/:repo/tree?ref=`: file paths and sizes, at most 5,000. */
export const GithubTree = z.object({
  sha: GitSha,
  truncated: z.boolean(),
  files: z
    .array(z.object({ path: FilePath, size: z.number().int().min(0) }))
    .max(GITHUB_TREE_MAX_FILES),
});
export type GithubTree = z.infer<typeof GithubTree>;

export const GithubContentsQuery = GithubRefQuery.extend({ path: FilePath });
export type GithubContentsQuery = z.infer<typeof GithubContentsQuery>;

/** `GET /github/repos/:owner/:repo/contents?path=&ref=`: one text file, at most 1 MB. */
export const GithubFile = z.object({
  path: FilePath,
  sha: GitSha,
  size: z.number().int().min(0).max(GITHUB_FILE_MAX_BYTES),
  content: z.string(),
});
export type GithubFile = z.infer<typeof GithubFile>;
