import {
  type AutofixContext,
  envExamplePaths,
  LiftApiError,
  LOG_SNAPSHOT_MAX_LINES,
  parseEnvExample,
} from "@lift/shared";
import type { LiftApi } from "../lift-api";

/** The model reads the log's last 400 lines (PRD 03, "Autofix", step 1). */
export const LOG_TAIL_LINES = 400;
/** At most 10 files, each cut at 20 KB. */
export const FAILURE_MAX_FILES = 10;
export const FAILURE_FILE_MAX_CHARS = 20_000;
const STACK_FILES_MAX = 5;

/** A log line, numbered as the deployment page shows it: 1 is the log's first line. */
export interface NumberedLine {
  n: number;
  stream: string;
  text: string;
}

export interface Failure {
  context: AutofixContext;
  lines: NumberedLine[];
  files: { path: string; content: string }[];
  /** The repo's own example values, for safe defaults. Never sent to the model unredacted. */
  envExample: Record<string, string>;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escape codes.
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
export const stripAnsi = (text: string) => text.replace(ANSI, "");

const MANIFESTS = [
  "package.json",
  "requirements.txt",
  "pyproject.toml",
  "Procfile",
  ".nvmrc",
  ".node-version",
  ".python-version",
  "runtime.txt",
];

/**
 * Repo files a stack trace names. Railpack runs the app from /app, which holds the service's
 * root directory, so `/app/src/index.js` is `{rootDir}/src/index.js`.
 */
export function pathsInLog(lines: NumberedLine[], rootDir: string): string[] {
  const found = new Set<string>();
  const pattern = /\/app\/((?:[\w.@-]+\/)*[\w.-]+\.(?:[cm]?[jt]sx?|py|go|rb))\b/g;
  for (const { text } of lines) {
    for (const match of text.matchAll(pattern)) {
      const path = match[1];
      if (path && !path.startsWith("node_modules/")) found.add(path);
    }
  }
  const base = rootDir === "." ? "" : `${rootDir}/`;
  return [...found].slice(0, STACK_FILES_MAX).map((path) => `${base}${path}`);
}

/** The files worth reading for a failure, in order: example env files, manifests, stack traces. */
export function failureFiles(rootDir: string, lines: NumberedLine[]): string[] {
  const base = rootDir === "." ? "" : `${rootDir}/`;
  return [
    ...new Set([
      ...envExamplePaths(rootDir),
      ...MANIFESTS.map((name) => `${base}${name}`),
      ...pathsInLog(lines, rootDir),
    ]),
  ];
}

/**
 * Loads what the model reads, through the public API as the project's owner: the whole log
 * (numbered from its first line, as the deployment page shows it) cut to its last 400 lines, and
 * up to 10 files at the failed commit that exist in the repo.
 */
export async function gatherFailure(api: LiftApi, context: AutofixContext): Promise<Failure> {
  const { deployment, service } = context;
  const snapshot = await api.deployments.logs(deployment.id, { tail: LOG_SNAPSHOT_MAX_LINES });
  const all = snapshot.data.map((entry, index) => ({
    n: index + 1,
    stream: entry.stream,
    text: stripAnsi(entry.line),
  }));
  const lines = all.slice(-LOG_TAIL_LINES);
  const { owner, name } = service.repo;
  const tree = await api.github.tree(owner, name, { ref: deployment.commitSha });
  const existing = new Set(tree.files.map((file) => file.path));
  const wanted = failureFiles(service.rootDir, lines)
    .filter((path) => existing.has(path))
    .slice(0, FAILURE_MAX_FILES);
  const files: Failure["files"] = [];
  for (const path of wanted) {
    try {
      const file = await api.github.contents(owner, name, path, { ref: deployment.commitSha });
      files.push({ path, content: file.content.slice(0, FAILURE_FILE_MAX_CHARS) });
    } catch (error) {
      if (error instanceof LiftApiError && (error.status === 400 || error.status === 404)) continue;
      throw error;
    }
  }
  const example = envExamplePaths(service.rootDir)
    .map((path) => files.find((file) => file.path === path))
    .find((file) => file !== undefined);
  return { context, lines, files, envExample: example ? parseEnvExample(example.content) : {} };
}
