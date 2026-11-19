import {
  cursorPage,
  GithubBranch,
  GithubLogin,
  GithubRepo,
  GithubRepoName,
  GithubReposQuery,
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

/** BE-04: what the repo picker needs, read with the signed-in user's own GitHub token. */
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
};
