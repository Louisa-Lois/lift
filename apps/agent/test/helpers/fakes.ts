import { Writable } from "node:stream";
import { type GithubFile, type GithubTree, LiftApiError, type OnboardingPlan } from "@lift/shared";
import Fastify, { type FastifyBaseLogger } from "fastify";
import type { Budget, BudgetSubject } from "../../src/budget";
import type { RepoReader } from "../../src/lift-api";
import type { Model, ModelAnswer, ModelRequest, Usage } from "../../src/llm";
import type { ModelPlan } from "../../src/planner/check";
import type { Prompts } from "../../src/prompts";

export const SHA = "3f9c2a1b7d4e5f60718293a4b5c6d7e8f9012345";
export const USAGE: Usage = {
  inputTokens: 1_200,
  outputTokens: 400,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/** Prompts for unit tests. Tests never look at a real prompt's wording. */
export const TEST_PROMPTS: Prompts = {
  planner: { name: "planner", text: "Test planner prompt.", hash: "000000000000" },
};

type Scripted = ModelAnswer | ((request: ModelRequest) => ModelAnswer);

/** A model that answers from a script and records every request it got. */
export function fakeModel(script: Scripted[]) {
  const requests: ModelRequest[] = [];
  const model: Model = async (request) => {
    requests.push(request);
    const next = script.shift();
    if (!next) throw new Error("the fake model has no more answers");
    return typeof next === "function" ? next(request) : next;
  };
  return { model, requests };
}

export const answer = (value: unknown, usage: Usage = USAGE): ModelAnswer => ({
  kind: "text",
  text: JSON.stringify(value),
  usage,
});

/** Input tokens per subject, in memory. */
export function memoryBudget(): Budget & { totals: Map<string, number> } {
  const totals = new Map<string, number>();
  const key = (subject: BudgetSubject) => `${subject.kind}:${subject.id}`;
  return {
    totals,
    async spent(subject) {
      return totals.get(key(subject)) ?? 0;
    },
    async add(subject, tokens) {
      totals.set(key(subject), (totals.get(key(subject)) ?? 0) + tokens);
    },
  };
}

/** A repo the planner reads through the fake: text files, and paths GitHub can't serve as text. */
export function fakeRepo(
  files: Record<string, string>,
  options: { binary?: string[]; extraTree?: { path: string; size: number }[] } = {},
) {
  const reads: { path: string; ref: string | undefined }[] = [];
  const all = { ...files };
  const repo: RepoReader = {
    async tree(_owner, _repo, params = {}): Promise<GithubTree> {
      return {
        sha: params.ref ?? SHA,
        truncated: false,
        files: [
          ...Object.entries(all).map(([path, content]) => ({
            path,
            size: Buffer.byteLength(content),
          })),
          ...(options.binary ?? []).map((path) => ({ path, size: 10 })),
          ...(options.extraTree ?? []),
        ],
      };
    },
    async contents(_owner, _repo, path, params = {}): Promise<GithubFile> {
      reads.push({ path, ref: params.ref });
      if (options.binary?.includes(path)) {
        throw new LiftApiError({
          type: "about:blank",
          title: "Invalid request",
          status: 400,
          detail: `${path} isn't a text file.`,
          code: "validation_failed",
          fields: { path: `${path} isn't a text file.` },
        });
      }
      const content = all[path];
      if (content === undefined) {
        throw new LiftApiError({
          type: "about:blank",
          title: "Not found",
          status: 404,
          detail: `No file ${path}`,
          code: "not_found",
        });
      }
      return { path, sha: SHA, size: Buffer.byteLength(content), content };
    },
  };
  return { repo, reads };
}

/** A logger that keeps every line it writes, to check what is (and isn't) logged. */
export function capturingLogger(): { log: FastifyBaseLogger; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(String(chunk));
      done();
    },
  });
  const app = Fastify({ logger: { level: "info", stream } });
  return { log: app.log, lines };
}

/** A sound answer for an Express app with Postgres, in the shape the model fills. */
export function goodPlan(overrides: Partial<ModelPlan> = {}): ModelPlan {
  return {
    summary: "An Express API with Postgres.",
    framework: "express",
    services: [
      {
        name: "api",
        rootDir: ".",
        type: "web",
        buildCommand: null,
        startCommand: "node server.js",
        port: 3000,
        healthcheckPath: "/health",
        rationale: "server.js listens on PORT.",
      },
    ],
    databases: [
      { type: "postgres", name: "notes-db", envVar: "DATABASE_URL", rationale: "Uses pg." },
    ],
    variables: [
      {
        key: "DATABASE_URL",
        source: "database",
        value: null,
        required: true,
        description: "Postgres.",
      },
      {
        key: "SESSION_SECRET",
        source: "generated",
        value: null,
        required: true,
        description: "Signs cookies.",
      },
      {
        key: "NODE_ENV",
        source: "default",
        value: "production",
        required: false,
        description: "Mode.",
      },
      {
        key: "STRIPE_SECRET_KEY",
        source: "user",
        value: null,
        required: true,
        description: "From Stripe.",
      },
    ],
    warnings: [],
    confidence: "high",
    ...overrides,
  };
}

export type { OnboardingPlan };
