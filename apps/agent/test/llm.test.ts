import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  anthropicModel,
  BudgetSpent,
  createLlm,
  JOBS,
  MAX_CALLS_PER_TASK,
  newTask,
  TooManyCalls,
} from "../src/llm";
import {
  answer,
  capturingLogger,
  fakeModel,
  memoryBudget,
  TEST_PROMPTS,
  USAGE,
} from "./helpers/fakes";

const Shape = z.object({ port: z.number().int() });
const SUBJECT = { kind: "user" as const, id: "usr_aaaaaaaaaaaaaaaaaaaaaaaa" };
const ask = (llm: ReturnType<typeof createLlm>, task = newTask(SUBJECT, 60_000)) =>
  llm.ask(task, {
    job: "plan",
    prompt: TEST_PROMPTS.planner,
    turns: [{ role: "user", content: "Which port? password=hunter2-secret" }],
    schema: Shape,
  });

function setup(script: Parameters<typeof fakeModel>[0], dailyBudget = 300_000) {
  const { model, requests } = fakeModel(script);
  const budget = memoryBudget();
  const { log, lines } = capturingLogger();
  return { llm: createLlm({ model, budget, dailyBudget, log }), requests, budget, lines };
}

describe("asking the model", () => {
  it("parses and checks the answer, and counts every input token against the subject", async () => {
    const { llm, budget } = setup([
      answer({ port: 8080 }, { ...USAGE, cacheReadTokens: 300, cacheWriteTokens: 100 }),
    ]);
    expect(await ask(llm)).toMatchObject({ ok: true, value: { port: 8080 } });
    expect(budget.totals.get(`user:${SUBJECT.id}`)).toBe(USAGE.inputTokens + 400);
  });

  it("returns the schema's problems for an answer that doesn't fit, with its text for a repair", async () => {
    const { llm } = setup([answer({ port: "eighty" })]);
    const result = await ask(llm);
    expect(result).toMatchObject({ ok: false, reason: "invalid", text: '{"port":"eighty"}' });
    expect(result.ok ? [] : result.problems[0]).toContain("port");
  });

  it("treats a refusal and a cut-off answer as failures, never as content", async () => {
    const { llm } = setup([
      { kind: "refusal", usage: USAGE },
      { kind: "truncated", usage: USAGE },
    ]);
    expect(await ask(llm)).toMatchObject({ ok: false, reason: "refusal" });
    expect(await ask(llm)).toMatchObject({ ok: false, reason: "truncated" });
  });

  it("stops before the call once the day's budget is spent", async () => {
    const { llm, requests, budget } = setup([answer({ port: 1 })], 1_000);
    await budget.add(SUBJECT, 1_000);
    await expect(ask(llm)).rejects.toBeInstanceOf(BudgetSpent);
    expect(requests).toHaveLength(0);
  });

  it("allows a task at most 20 calls, and none once its deadline is close", async () => {
    const { llm } = setup([]);
    const task = newTask(SUBJECT, 60_000);
    task.calls = MAX_CALLS_PER_TASK;
    await expect(ask(llm, task)).rejects.toBeInstanceOf(TooManyCalls);
    await expect(ask(llm, newTask(SUBJECT, 1_000))).rejects.toBeInstanceOf(TooManyCalls);
  });

  it("logs the model, the prompt's hash and the tokens of each call, never its content", async () => {
    const { llm, lines } = setup([answer({ port: 8080 })]);
    await ask(llm);
    const logged = lines.join("\n");
    expect(logged).toContain('"model":"claude-sonnet-5-5"');
    expect(logged).toContain(`"prompt":"planner@${TEST_PROMPTS.planner.hash}"`);
    expect(logged).toContain(`"inputTokens":${USAGE.inputTokens}`);
    expect(logged).not.toContain("hunter2");
    expect(logged).not.toContain("8080");
  });
});

describe("the Anthropic request", () => {
  function recordingFetch(response: object) {
    const bodies: Record<string, unknown>[] = [];
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [{ type: "text", text: '{"port":3000}' }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
        ...response,
      });
    };
    return { fetch, bodies };
  }

  it("asks for structured output, with no temperature and no forced tool", async () => {
    const { fetch, bodies } = recordingFetch({});
    const model = anthropicModel("sk-test-not-a-key", { fetch });
    const result = await model({
      job: "plan",
      system: "System text",
      turns: [{ role: "user", content: "Hi" }],
      schema: Shape,
      timeoutMs: 10_000,
    });
    expect(result).toMatchObject({ kind: "text", text: '{"port":3000}' });
    const body = bodies[0] ?? {};
    expect(body.model).toBe(JOBS.plan.model);
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body).not.toHaveProperty("thinking");
    expect(body.output_config).toMatchObject({ effort: "medium", format: { type: "json_schema" } });
    expect(body.system).toEqual([
      { type: "text", text: "System text", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("turns thinking off for classifying, on Haiku", async () => {
    const { fetch, bodies } = recordingFetch({});
    await anthropicModel("sk-test-not-a-key", { fetch })({
      job: "classify",
      system: "S",
      turns: [{ role: "user", content: "Hi" }],
      schema: Shape,
      timeoutMs: 10_000,
    });
    expect(bodies[0]).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 300,
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
    });
  });

  it("reports a refusal or a cut-off answer before reading any content", async () => {
    for (const [stop, kind] of [
      ["refusal", "refusal"],
      ["max_tokens", "truncated"],
    ] as const) {
      const { fetch } = recordingFetch({ stop_reason: stop });
      const result = await anthropicModel("sk-test-not-a-key", { fetch })({
        job: "plan",
        system: "S",
        turns: [{ role: "user", content: "Hi" }],
        schema: Shape,
        timeoutMs: 10_000,
      });
      expect(result.kind).toBe(kind);
    }
  });
});
