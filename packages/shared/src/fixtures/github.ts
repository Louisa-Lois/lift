import { z } from "zod";
import { type GithubBranch, GithubRepo } from "../schemas/github";

/** What the repo picker lists: the `lift-demo` organisation's repos and one private repo. */
export const githubRepos = z.array(GithubRepo).parse([
  {
    owner: "lift-demo",
    name: "next-hello",
    private: false,
    defaultBranch: "main",
    pushedAt: "2026-11-18T08:41:00Z",
  },
  {
    owner: "lift-demo",
    name: "express-postgres",
    private: false,
    defaultBranch: "main",
    pushedAt: "2026-11-17T09:27:40Z",
  },
  {
    owner: "lift-demo",
    name: "static-site",
    private: false,
    defaultBranch: "main",
    pushedAt: "2026-11-15T16:02:11Z",
  },
  {
    owner: "lift-demo",
    name: "broken-port",
    private: false,
    defaultBranch: "main",
    pushedAt: "2026-11-15T16:40:57Z",
  },
  {
    owner: "ama-owusu",
    name: "portfolio",
    private: true,
    defaultBranch: "main",
    pushedAt: "2026-11-12T20:14:03Z",
  },
]);

/** Branches by `owner/name`. */
export const githubBranches: Record<string, GithubBranch[]> = {
  "lift-demo/next-hello": [{ name: "main" }, { name: "dev" }, { name: "feature/checkout" }],
  "lift-demo/express-postgres": [{ name: "main" }, { name: "orders-v2" }],
  "lift-demo/static-site": [{ name: "main" }, { name: "gh-pages" }],
  "lift-demo/broken-port": [{ name: "main" }],
  "ama-owusu/portfolio": [{ name: "main" }],
};
