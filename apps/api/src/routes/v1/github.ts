import {
  cursorPage,
  GITHUB_FILE_MAX_BYTES,
  GithubBranch,
  GithubContentsQuery,
  GithubFile,
  GithubLogin,
  GithubRefQuery,
  GithubRepo,
  GithubRepoName,
  GithubReposQuery,
  GithubTree,
} from "@lift/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { numberCursor } from "../../lib/pagination";
import { problem } from "../../lib/problem";
import { requireUser } from "../../plugins/auth";
import type { SecretBox } from "../../services/crypto";
import { GITHUB_MAX_PAGES, type Github } from "../../services/github";
import { githubTokenOf } from "../../services/users";

const RepoParams = z.object({ owner: GithubLogin, repo: GithubRepoName });

export interface GithubRoutesOptions {
  github: Github;
  secretBox: SecretBox | null;
}

const MB = 1024 * 1024;

/**
 * BE-04: what the repo picker needs, and AI-02: what the agent reads to plan a deployment or
 * diagnose a failure (the tree and single files). All of it with the caller's own GitHub token.
 */
export const githubRoutes: FastifyPluginAsyncZod<GithubRoutesOptions> = async (
  app,
  { github, secretBox },
) => {
  app.get(
    "/github/repos",
    {
      schema: {
        summary: "Repos you can access, most recently pushed first; `query` searches owner/name",
        tags: ["github"],
        querystring: GithubReposQuery,
        response: { 200: cursorPage(GithubRepo) },
      },
    },
    async (request) => {
      const token = githubTokenOf(secretBox, requireUser(request));
      const { limit, cursor, query } = request.query;
      if (!query) {
        // The cursor is GitHub's page number.
        const page = Math.max(1, numberCursor(cursor, 1));
        const { repos, hasNext } = await github.listRepos(token, page, limit);
        return { data: repos, nextCursor: hasNext ? String(page + 1) : null };
      }
      // GitHub can't search "repos I can access", so filter the 500 most recently pushed. The
      // cursor is an offset into the matches.
      const needle = query.toLowerCase();
      const matches: GithubRepo[] = [];
      for (let page = 1; page <= GITHUB_MAX_PAGES; page += 1) {
        const { repos, hasNext } = await github.listRepos(token, page, 100);
        matches.push(
          ...repos.filter((repo) => `${repo.owner}/${repo.name}`.toLowerCase().includes(needle)),
        );
        if (!hasNext) break;
      }
      const offset = numberCursor(cursor, 0);
      return {
        data: matches.slice(offset, offset + limit),
        nextCursor: offset + limit < matches.length ? String(offset + limit) : null,
      };
    },
  );

  app.get(
    "/github/repos/:owner/:repo/branches",
    {
      schema: {
        summary: "A repo's branches (all of them, up to 500)",
        tags: ["github"],
        params: RepoParams,
        response: { 200: cursorPage(GithubBranch) },
      },
    },
    async (request) => {
      const token = githubTokenOf(secretBox, requireUser(request));
      const { owner, repo } = request.params;
      const branches = await github.listBranches(token, owner, repo);
      if (!branches) throw problem("not_found", `You can't read ${owner}/${repo} on GitHub.`);
      return { data: branches, nextCursor: null };
    },
  );

  app.get(
    "/github/repos/:owner/:repo/tree",
    {
      schema: {
        summary: "A repo's file paths and sizes at a branch, tag or commit (at most 5,000)",
        description:
          "Without `ref`, the default branch. `sha` is the commit the ref resolved to, so later reads can use it as their `ref`. Folders and submodules aren't listed; `truncated` says some files were left out.",
        tags: ["github"],
        params: RepoParams,
        querystring: GithubRefQuery,
        response: { 200: GithubTree },
      },
    },
    async (request) => {
      const token = githubTokenOf(secretBox, requireUser(request));
      const { owner, repo } = request.params;
      const { ref } = request.query;
      const tree = await github.getTree(token, owner, repo, ref);
      if (!tree) {
        throw problem(
          "not_found",
          ref
            ? `${owner}/${repo} has no branch, tag or commit ${ref}, or you can't read it on GitHub.`
            : `You can't read ${owner}/${repo} on GitHub.`,
        );
      }
      return tree;
    },
  );

  app.get(
    "/github/repos/:owner/:repo/contents",
    {
      schema: {
        summary: "One text file from a repo, at a branch, tag or commit (at most 1 MB)",
        description:
          "Without `ref`, the default branch. A folder, a binary file or a file over 1 MB is a validation error on `path`.",
        tags: ["github"],
        params: RepoParams,
        querystring: GithubContentsQuery,
        response: { 200: GithubFile },
      },
    },
    async (request) => {
      const token = githubTokenOf(secretBox, requireUser(request));
      const { owner, repo } = request.params;
      const { path, ref } = request.query;
      const found = await github.getContents(token, owner, repo, path, ref);
      const invalid = (message: string) =>
        problem("validation_failed", message, { fields: { path: message } });
      switch (found.kind) {
        case "file":
          return found.file;
        case "not_found":
          throw problem(
            "not_found",
            `${owner}/${repo} has no file ${path}${ref ? ` at ${ref}` : ""}, or you can't read it on GitHub.`,
          );
        case "folder":
          throw invalid(`${path} is a folder, not a file.`);
        case "binary":
          throw invalid(`${path} isn't a text file.`);
        case "too_large":
          throw invalid(
            `${path} is ${(found.size / MB).toFixed(1)} MB; Lift reads files up to ${GITHUB_FILE_MAX_BYTES / MB} MB.`,
          );
      }
    },
  );
};
