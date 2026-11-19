import { AgentPlanResponse, Problem } from "@lift/shared";
import { afterAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server";
import {
  answer,
  fakeModel,
  fakeRepo,
  goodPlan,
  memoryBudget,
  SHA,
  TEST_PROMPTS,
} from "./helpers/fakes";

const TOKEN = `lift_svc_${"a".repeat(32)}`;
const USER = "usr_aaaaaaaaaaaaaaaaaaaaaaaa";
const ENV = {
  LOG_LEVEL: "silent" as const,
  AGENT_SERVICE_TOKEN: TOKEN,
  AGENT_DAILY_TOKEN_BUDGET: 300_000,
};
const BODY = { owner: "lift-demo", repo: "express-postgres", branch: "main", commitSha: SHA };
const FILES = { "package.json": "{}", "server.js": "listen(3000)" };

function serve(script: Parameters<typeof fakeModel>[0], options: { model?: boolean } = {}) {
  const { model } = fakeModel(script);
  const budget = memoryBudget();
  const { repo } = fakeRepo(FILES);
  const app = buildServer(ENV, {
    prompts: TEST_PROMPTS,
    budget,
    model: options.model === false ? null : model,
    repoFor: () => repo,
  });
  apps.push(app);
  return { app, budget };
}
const apps: ReturnType<typeof buildServer>[] = [];
afterAll(async () => {
  for (const app of apps) await app.close();
});

const plan = (
  app: ReturnType<typeof buildServer>,
  headers: Record<string, string>,
  payload: object = BODY,
) => app.inject({ method: "POST", url: "/plans", headers, payload });
const auth = { authorization: `Bearer ${TOKEN}`, "x-lift-user": USER };

describe("POST /plans", () => {
  it("plans the repo for the API", async () => {
    const { app } = serve([answer(goodPlan())]);
    const response = await plan(app, auth);
    expect(response.statusCode).toBe(200);
    expect(AgentPlanResponse.parse(response.json()).repo.commitSha).toBe(SHA);
  });

  it("answers only the API: AGENT_SERVICE_TOKEN, and a user", async () => {
    const { app } = serve([]);
    const refused: Record<string, string>[] = [
      {},
      { authorization: `Bearer lift_svc_${"b".repeat(32)}`, "x-lift-user": USER },
    ];
    for (const headers of refused) {
      const response = await plan(app, headers);
      expect(response.statusCode).toBe(401);
      expect(response.headers["content-type"]).toContain("application/problem+json");
    }
    expect((await plan(app, { authorization: auth.authorization })).statusCode).toBe(400);
    expect((await plan(app, auth, { owner: "lift-demo" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });

  it("says why it can't plan: no model, a spent budget, a plan it couldn't fix", async () => {
    const { app: noModel } = serve([], { model: false });
    expect(Problem.parse((await plan(noModel, auth)).json())).toMatchObject({ status: 503 });

    const { app: spent, budget } = serve([answer(goodPlan())]);
    await budget.add({ kind: "user", id: USER }, 300_000);
    const limited = Problem.parse((await plan(spent, auth)).json());
    expect(limited).toMatchObject({ status: 429, code: "rate_limited" });
    expect(limited.detail).toContain("300,000");

    const bad = goodPlan({ services: [] });
    const { app: failing } = serve([answer(bad), answer(bad)]);
    expect(Problem.parse((await plan(failing, auth)).json())).toMatchObject({
      status: 503,
      code: "upstream_unavailable",
    });
  });
});
