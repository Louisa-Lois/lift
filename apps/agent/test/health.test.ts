import { afterAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server";
import { memoryBudget, TEST_PROMPTS } from "./helpers/fakes";

describe("GET /health", () => {
  const app = buildServer(
    { LOG_LEVEL: "silent", AGENT_SERVICE_TOKEN: undefined, AGENT_DAILY_TOKEN_BUDGET: 300_000 },
    { prompts: TEST_PROMPTS, budget: memoryBudget(), model: null, repoFor: null },
  );
  afterAll(() => app.close());

  it("answers ok, without a token", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
