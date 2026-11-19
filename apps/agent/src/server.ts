import { createHash, timingSafeEqual } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import {
  AGENT_USER_HEADER,
  AgentPlanRequest,
  ERROR_STATUS,
  type ErrorCode,
  LiftApiError,
  PROBLEM_CONTENT_TYPE,
  UserId,
} from "@lift/shared";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type { Budget } from "./budget";
import type { Env } from "./env";
import type { RepoReader } from "./lift-api";
import { BudgetSpent, createLlm, type Model, newTask, TooManyCalls } from "./llm";
import { PLAN_TIME_MS, PlanFailed, planRepo } from "./planner/planner";
import type { Prompts } from "./prompts";

export interface AgentDeps {
  prompts: Prompts;
  budget: Budget;
  /** Null without ANTHROPIC_API_KEY (development): planning answers 503. */
  model: Model | null;
  /** The API's GitHub reads as one user; null without AGENT_SERVICE_TOKEN. */
  repoFor: ((userId: string) => RepoReader) | null;
}

class Problem extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly detail: string,
  ) {
    super(detail);
  }
}

const TITLES: Partial<Record<ErrorCode, string>> = {
  unauthenticated: "Sign in required",
  validation_failed: "Invalid request",
  rate_limited: "Too many requests",
  upstream_unavailable: "Service unavailable",
  internal: "Something went wrong",
};

function sendProblem(reply: FastifyReply, code: ErrorCode, detail: string) {
  const status = ERROR_STATUS[code];
  return reply
    .code(status)
    .type(PROBLEM_CONTENT_TYPE)
    .send({ type: "about:blank", title: TITLES[code] ?? "Error", status, detail, code });
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/** What a failed plan tells the user, through the API. Never a token or a file's content. */
function problemFor(error: unknown, dailyBudget: number): Problem | null {
  if (error instanceof Problem) return error;
  if (error instanceof BudgetSpent) {
    return new Problem(
      "rate_limited",
      `You've used today's AI budget for plans (${dailyBudget.toLocaleString("en-US")} input tokens). It resets at midnight UTC; you can still configure the service yourself.`,
    );
  }
  if (error instanceof PlanFailed) {
    return new Problem(
      "upstream_unavailable",
      `The assistant couldn't plan this repo: ${error.message}.`,
    );
  }
  if (error instanceof TooManyCalls) {
    return new Problem("upstream_unavailable", "The assistant ran out of time planning this repo.");
  }
  // The API refused a read, for example a repo the user can't read: pass its answer on.
  if (error instanceof LiftApiError) return new Problem(error.code, error.detail);
  if (error instanceof Anthropic.APIError) {
    return new Problem(
      "upstream_unavailable",
      error instanceof Anthropic.APIConnectionTimeoutError
        ? "The AI provider didn't answer in time."
        : `The AI provider answered ${error.status ?? "with an error"}.`,
    );
  }
  return null;
}

/**
 * The agent service is internal only: the API calls it with AGENT_SERVICE_TOKEN, and it never
 * sits behind the public router. `POST /plans` (AI-03) is here; chat and approvals come later
 * (docs/prd/03-ai-agent.md).
 */
export function buildServer(
  env: Pick<Env, "LOG_LEVEL" | "AGENT_SERVICE_TOKEN" | "AGENT_DAILY_TOKEN_BUDGET">,
  deps: AgentDeps,
): FastifyInstance {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie"],
        censor: "[redacted]",
      },
    },
  });
  const expected = env.AGENT_SERVICE_TOKEN ? digest(env.AGENT_SERVICE_TOKEN) : null;
  const llm = deps.model
    ? createLlm({
        model: deps.model,
        budget: deps.budget,
        dailyBudget: env.AGENT_DAILY_TOKEN_BUDGET,
        log: app.log,
      })
    : null;

  app.setErrorHandler((error, request, reply) => {
    const known = problemFor(error, env.AGENT_DAILY_TOKEN_BUDGET);
    if (known) return sendProblem(reply, known.code, known.detail);
    request.log.error({ err: error }, "request failed");
    return sendProblem(reply, "internal", "The assistant failed unexpectedly.");
  });

  app.get("/health", async () => ({ status: "ok" as const }));

  // Everything else is the API's to call, with AGENT_SERVICE_TOKEN compared in constant time.
  app.addHook("onRequest", async (request) => {
    if (request.url === "/health") return;
    const header = request.headers.authorization ?? "";
    const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!expected || !given || !timingSafeEqual(digest(given), expected)) {
      throw new Problem("unauthenticated", "Send Authorization: Bearer with AGENT_SERVICE_TOKEN.");
    }
  });

  app.post("/plans", async (request) => {
    const userId = UserId.safeParse(request.headers[AGENT_USER_HEADER.toLowerCase()]);
    if (!userId.success) {
      throw new Problem("validation_failed", `Send ${AGENT_USER_HEADER} with the user's ID.`);
    }
    const body = AgentPlanRequest.safeParse(request.body);
    if (!body.success) {
      throw new Problem("validation_failed", "Send the owner, repo, branch and commitSha to plan.");
    }
    if (!llm || !deps.repoFor) {
      throw new Problem(
        "upstream_unavailable",
        "The assistant isn't set up on this server (ANTHROPIC_API_KEY or AGENT_SERVICE_TOKEN is missing).",
      );
    }
    const task = newTask({ kind: "user", id: userId.data }, PLAN_TIME_MS);
    return planRepo(
      { llm, prompts: deps.prompts, repo: deps.repoFor(userId.data) },
      body.data,
      task,
    );
  });

  return app;
}
