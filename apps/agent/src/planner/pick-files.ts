import { type GithubTree, LiftApiError } from "@lift/shared";
import type { RepoReader } from "../lift-api";

/** PRD 03: at most 25 files and 150 KB for one plan. */
export const PLAN_MAX_FILES = 25;
export const PLAN_MAX_BYTES = 150 * 1024;
/** A file over this size isn't read (PRD 03's `read_file` limit); the README is cut instead. */
export const PLAN_FILE_MAX_BYTES = 100 * 1024;
export const README_MAX_LINES = 200;

const ENV_EXAMPLE = /^\.env\.(?:example|sample|template)$/i;
const README = /^readme(?:\.md|\.markdown|\.txt|\.rst)?$/i;

/** Never read, whatever else matches: secrets, keys, and folders of built or vendored code. */
const NEVER = [
  /(?:^|\/)\.env(?:\.[^/]*)?$/i,
  /\.(?:pem|key|p12|pfx|jks|keystore|crt|cer)$/i,
  /(?:^|\/)id_(?:rsa|dsa|ecdsa|ed25519)/i,
  /(?:^|\/)\.(?:npmrc|pypirc|netrc|git-credentials)$/i,
  /credential|secret/i,
  /(?:^|\/)(?:node_modules|vendor|\.git|dist|build|\.next|\.venv|venv)\//,
];

const MANIFESTS = new Set([
  "requirements.txt",
  "pyproject.toml",
  "Pipfile",
  "Procfile",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
  "railpack.json",
  "go.mod",
  "Gemfile",
  "composer.json",
  "Cargo.toml",
  ".nvmrc",
  ".node-version",
  ".python-version",
  "runtime.txt",
]);
const FRAMEWORK_CONFIG =
  /^(?:next|vite|astro|nuxt|svelte|remix|gatsby|vue)\.config\.[cm]?[jt]s$|^angular\.json$|^nest-cli\.json$/;
const ORM = /(?:^|\/)schema\.prisma$|^drizzle\.config\.[cm]?[jt]s$/;
/** Where an app usually says which port it listens on. */
const ENTRY_FILES = new Set([
  "server.js",
  "server.ts",
  "index.js",
  "index.ts",
  "app.js",
  "app.ts",
  "main.js",
  "main.ts",
  "src/server.js",
  "src/server.ts",
  "src/index.js",
  "src/index.ts",
  "src/app.js",
  "src/app.ts",
  "src/main.js",
  "src/main.ts",
  "app.py",
  "main.py",
  "manage.py",
  "wsgi.py",
  "asgi.py",
  "main.go",
]);
const LOCKFILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "Gemfile.lock",
  "go.sum",
  "composer.lock",
  "Cargo.lock",
]);

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const depthOf = (path: string) => path.split("/").length - 1;

/**
 * How useful a file is for a plan, in PRD 03's order (lower first): the root package.json, other
 * root manifests and `.env.example`, framework configs, the README, ORM schemas, nested
 * manifests, then the files where apps usually start. Null: not read.
 */
export function rank(path: string): number | null {
  const name = nameOf(path);
  const depth = depthOf(path);
  if (!ENV_EXAMPLE.test(name) && NEVER.some((pattern) => pattern.test(path))) return null;
  if (depth === 0) {
    if (name === "package.json") return 0;
    if (MANIFESTS.has(name) || ENV_EXAMPLE.test(name)) return 1;
    if (FRAMEWORK_CONFIG.test(name)) return 2;
    if (README.test(name)) return 3;
  }
  if (ORM.test(path)) return 4;
  if (
    depth <= 2 &&
    (name === "package.json" || MANIFESTS.has(name) || FRAMEWORK_CONFIG.test(name))
  ) {
    return 5;
  }
  if (ENTRY_FILES.has(path)) return 6;
  return null;
}

const isRootReadme = (path: string) => depthOf(path) === 0 && README.test(path);

/** The files to read, most useful first, within the caps. A README counts for at most 16 KB. */
export function pickFiles(tree: GithubTree): string[] {
  const candidates = tree.files
    .map((file) => ({ ...file, rank: rank(file.path) }))
    .filter(
      (file): file is typeof file & { rank: number } =>
        file.rank !== null && (file.size <= PLAN_FILE_MAX_BYTES || isRootReadme(file.path)),
    )
    .sort(
      (a, b) =>
        a.rank - b.rank || depthOf(a.path) - depthOf(b.path) || a.path.localeCompare(b.path),
    );
  const picked: string[] = [];
  let bytes = 0;
  for (const file of candidates) {
    if (picked.length >= PLAN_MAX_FILES) break;
    const size = isRootReadme(file.path) ? Math.min(file.size, 16 * 1024) : file.size;
    if (bytes + size > PLAN_MAX_BYTES) continue;
    picked.push(file.path);
    bytes += size;
  }
  return picked;
}

/** The repo's top level (files and folders) and its lockfiles: names only, never their content. */
export function outline(tree: GithubTree): { topLevel: string[]; lockfiles: string[] } {
  const topLevel = new Set<string>();
  const lockfiles: string[] = [];
  for (const { path } of tree.files) {
    const slash = path.indexOf("/");
    topLevel.add(slash === -1 ? path : `${path.slice(0, slash)}/`);
    if (depthOf(path) <= 1 && LOCKFILES.has(nameOf(path))) lockfiles.push(path);
  }
  return { topLevel: [...topLevel].sort().slice(0, 100), lockfiles: lockfiles.sort() };
}

export interface RepoFile {
  path: string;
  content: string;
}

/**
 * Reads the picked files at the planned commit, six at a time, keeping the first 200 lines of the
 * README and at most 150 KB in all. A file GitHub can't serve as text (binary, too big, gone) is
 * skipped; any other error stops the plan.
 */
export async function readFiles(
  repo: RepoReader,
  at: { owner: string; repo: string; commitSha: string },
  paths: string[],
): Promise<RepoFile[]> {
  const contents: (string | null)[] = new Array(paths.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < paths.length) {
      const index = next++;
      const path = paths[index] as string;
      try {
        const file = await repo.contents(at.owner, at.repo, path, { ref: at.commitSha });
        contents[index] = isRootReadme(path)
          ? file.content.split("\n").slice(0, README_MAX_LINES).join("\n")
          : file.content;
      } catch (error) {
        if (error instanceof LiftApiError && (error.status === 400 || error.status === 404))
          continue;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  const files: RepoFile[] = [];
  let bytes = 0;
  for (const [index, content] of contents.entries()) {
    if (content === null) continue;
    const size = Buffer.byteLength(content);
    if (bytes + size > PLAN_MAX_BYTES) continue;
    files.push({ path: paths[index] as string, content });
    bytes += size;
  }
  return files;
}
