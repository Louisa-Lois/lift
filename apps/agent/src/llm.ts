import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { FastifyBaseLogger } from "fastify";
import type { z } from "zod";
import type { Budget, BudgetSubject } from "./budget";
import type { Prompt } from "./prompts";

/**
 * The model and settings for each job. PRD 03 asks for forced tool calls at temperature 0, but
 * Sonnet 5.5 answers 400 to a forced `tool_choice` and the 5.5 models reject a non-default
 * `temperature`. So answers come as structured output (`output_config.format`), checked by Zod
 * and then by Lift's own rules, which is what makes them predictable.
 */
export const JOBS = {
  plan: {
    model: "claude-sonnet-5-5",
    effort: "medium",
    thinking: "adaptive",
    maxTokens: 16_000,
    timeoutMs: 55_000,
  },
  classify: {
    model: "claude-haiku-5-5",
    effort: "low",
    thinking: "off",
    maxTokens: 300,
    timeoutMs: 30_000,
  },
  fix: {
    model: "claude-sonnet-5-5",
    effort: "medium",
    thinking: "adaptive",
    maxTokens: 8_000,
    timeoutMs: 90_000,
  },
} as const;
export type Job = keyof typeof JOBS;

/** A task (one plan, one autofix attempt) makes at most this many model calls (PRD 03). */
export const MAX_CALLS_PER_TASK = 20;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** What counts against the daily budget: every input token, cached or not. */
export const inputTokensOf = (usage: Usage) =>
  usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export interface ModelRequest {
  job: Job;
  system: string;
  turns: Turn[];
  schema: z.ZodType;
  /** At most this long; less when the task's deadline is near. */
  timeoutMs: number;
}

export type ModelAnswer =
  | { kind: "text"; text: string; usage: Usage }
  | { kind: "refusal"; usage: Usage }
  | { kind: "truncated"; usage: Usage };

/** The one place Lift talks to the model. Tests pass a fake: no test calls Anthropic. */
export type Model = (request: ModelRequest) => Promise<ModelAnswer>;

export function anthropicModel(
  apiKey: string,
  /** Tests pass a fetch that answers like the API; nothing in a test reaches Anthropic. */
  options: { fetch?: typeof globalThis.fetch } = {},
): Model {
  const client = new Anthropic({
    apiKey,
    maxRetries: 1,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return async ({ job, system, turns, schema, timeoutMs }) => {
    const settings = JOBS[job];
    const message = await client.messages.create(
      {
        model: settings.model,
        max_tokens: settings.maxTokens,
        // Cached once it's long enough (512 tokens on these models); a short prompt just isn't.
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: turns,
        output_config: { effort: settings.effort, format: zodOutputFormat(schema) },
        ...(settings.thinking === "off" ? { thinking: { type: "disabled" as const } } : {}),
      },
      { timeout: timeoutMs },
    );
    const usage: Usage = {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    };
    // Checked before reading the content: a refusal or a cut-off answer has no usable JSON.
    if (message.stop_reason === "refusal") return { kind: "refusal", usage };
    if (message.stop_reason === "max_tokens") return { kind: "truncated", usage };
    const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : []));
    return { kind: "text", text: text.join(""), usage };
  };
}

/** The day's budget for this project or user is spent: the task stops and says so. */
export class BudgetSpent extends Error {
  override readonly name = "BudgetSpent";
  constructor(readonly subject: BudgetSubject) {
    super(`Today's AI budget for this ${subject.kind} is spent`);
  }
}

/** A task asked for more model calls than it may make. */
export class TooManyCalls extends Error {
  override readonly name = "TooManyCalls";
}

/** One plan or one autofix attempt: who pays for it, how many calls it made, and its deadline. */
export interface Task {
  subject: BudgetSubject;
  calls: number;
  deadline: number;
}

export function newTask(subject: BudgetSubject, budgetMs: number, now = Date.now()): Task {
  return { subject, calls: 0, deadline: now + budgetMs };
}

export type Answer<T> =
  | { ok: true; value: T; text: string }
  | { ok: false; reason: "refusal" | "truncated" | "invalid"; problems: string[]; text?: string };

export interface LlmDeps {
  model: Model;
  budget: Budget;
  dailyBudget: number;
  log: FastifyBaseLogger;
}

export type Llm = ReturnType<typeof createLlm>;

/**
 * Asks the model for an answer of a given shape. Before the call: the task's call cap, its
 * deadline and the day's budget. After it: the tokens are counted, one log line records the call
 * (never its content), and the answer is parsed and checked against the schema.
 */
export function createLlm(deps: LlmDeps) {
  async function ask<S extends z.ZodType>(
    task: Task,
    request: { job: Job; prompt: Prompt; turns: Turn[]; schema: S },
  ): Promise<Answer<z.output<S>>> {
    if (task.calls >= MAX_CALLS_PER_TASK)
      throw new TooManyCalls(`More than ${MAX_CALLS_PER_TASK} model calls`);
    const timeoutMs = Math.min(JOBS[request.job].timeoutMs, task.deadline - Date.now());
    if (timeoutMs < 5_000) throw new TooManyCalls("No time left for another model call");
    if ((await deps.budget.spent(task.subject)) >= deps.dailyBudget) {
      throw new BudgetSpent(task.subject);
    }
    task.calls += 1;
    const started = Date.now();
    const answer = await deps.model({
      job: request.job,
      system: request.prompt.text,
      turns: request.turns,
      schema: request.schema,
      timeoutMs,
    });
    await deps.budget.add(task.subject, inputTokensOf(answer.usage));
    deps.log.info(
      {
        job: request.job,
        model: JOBS[request.job].model,
        prompt: `${request.prompt.name}@${request.prompt.hash}`,
        subject: `${task.subject.kind}:${task.subject.id}`,
        ...answer.usage,
        ms: Date.now() - started,
        outcome: answer.kind,
      },
      "model call",
    );
    if (answer.kind === "refusal") {
      return { ok: false, reason: "refusal", problems: ["The model declined to answer."] };
    }
    if (answer.kind === "truncated") {
      return { ok: false, reason: "truncated", problems: ["The answer was cut off."] };
    }
    let json: unknown;
    try {
      json = JSON.parse(answer.text);
    } catch {
      return {
        ok: false,
        reason: "invalid",
        problems: ["The answer isn't JSON."],
        text: answer.text,
      };
    }
    const parsed = request.schema.safeParse(json);
    if (!parsed.success) {
      const problems = parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "the answer"}: ${issue.message}`,
      );
      return { ok: false, reason: "invalid", problems, text: answer.text };
    }
    return { ok: true, value: parsed.data, text: answer.text };
  }

  return { ask };
}
