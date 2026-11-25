import { onboardingPlan } from "@lift/shared/fixtures";
import { describe, expect, it, vi } from "vitest";
import { equalCommand, options, planCase, type RepoCase, score, summarize } from "../run";

const sha = "a".repeat(40);
const firstPlanService = onboardingPlan.services[0];
if (!firstPlanService) throw new Error("Fixture plan has no service");

function repoCase(overrides: Partial<RepoCase> = {}): RepoCase {
  return {
    id: "fixture-case",
    repo: "owner/repo",
    ref: sha,
    stack: "express",
    golden: {
      services: [{ type: "web", port: 3000, startCommand: "node server.js" }],
      databases: ["postgres"],
      requiredVariables: ["DATABASE_URL"],
    },
    breakage: null,
    ...overrides,
  };
}

describe("command comparison", () => {
  it("accepts equivalent npm, pnpm, and yarn start forms", () => {
    expect(equalCommand("npm start", "npm run start", 3000)).toBe(true);
    expect(equalCommand("pnpm start", "pnpm run start", 3000)).toBe(true);
    expect(equalCommand("yarn start", "yarn run start", 3000)).toBe(true);
  });

  it("matches port variables to the planned service port", () => {
    expect(
      equalCommand("npm run start -- --port 8000", `npm start -- --port \${PORT:-8000}`, 8000),
    ).toBe(true);
    expect(equalCommand("uvicorn app:api --port 3000", "uvicorn app:api --port $PORT", 3000)).toBe(
      true,
    );
  });

  it("keeps null commands distinct from explicit commands", () => {
    expect(equalCommand(null, null, 3000)).toBe(true);
    expect(equalCommand(null, "npm start", 3000)).toBe(false);
  });
});

describe("options", () => {
  it("parses a selected case and concurrency", () => {
    expect(options(["--only", "fixture-case", "--concurrency", "2"])).toEqual({
      only: "fixture-case",
      concurrency: 2,
    });
  });

  it("rejects concurrency outside the supported range", () => {
    expect(() => options(["--concurrency", "11"])).toThrow("--concurrency must be an integer");
  });
});

describe("plan scoring", () => {
  it("accepts any port for static services and scores command alternatives", () => {
    const testCase = repoCase({
      golden: {
        services: [{ type: "static", port: 3000, startCommand: ["npm run start"] }],
        databases: [],
        requiredVariables: [],
      },
    });
    const plan = {
      ...onboardingPlan,
      services: [
        {
          ...firstPlanService,
          type: "static" as const,
          port: 8080,
          startCommand: "npm start",
        },
      ],
      databases: [],
      variables: [],
    };

    const result = score(testCase.golden, plan);

    expect(result.dimensions.port).toBeUndefined();
    expect(result.dimensions.startCommand?.passed).toBe(true);
    expect(result.score).toEqual({ correct: 5, total: 5, passed: true });
  });
});

describe("planCase", () => {
  it("sends the pinned SHA via commitSha and validates the response with the shared schema", async () => {
    const testCase = repoCase();
    const plan = structuredClone(onboardingPlan);
    plan.repo.commitSha = sha;
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        owner: "owner",
        repo: "repo",
        commitSha: sha,
      });
      return new Response(JSON.stringify(plan), { status: 200 });
    });

    const result = await planCase(testCase, fetcher);

    expect(result.status).toBe("scored");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.plan?.variables.every((variable) => !("value" in variable))).toBe(true);
  });

  it("keeps the API problem code and detail for failed cases", async () => {
    const testCase = repoCase();
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            type: "about:blank",
            title: "Budget exhausted",
            status: 429,
            detail: "The daily token budget is exhausted.",
            code: "rate_limited",
          }),
          { status: 429, headers: { "content-type": "application/problem+json" } },
        ),
    );

    const result = await planCase(testCase, fetcher);

    expect(result.status).toBe("error");
    expect(result.error).toEqual({
      httpStatus: 429,
      code: "rate_limited",
      detail: "The daily token budget is exhausted.",
    });
  });

  it("rejects a successful response that does not match the shared plan schema", async () => {
    const result = await planCase(repoCase(), async () => new Response("{}", { status: 200 }));

    expect(result.status).toBe("error");
    expect(result.error?.detail).toBeTruthy();
  });
});

describe("run summary", () => {
  it("counts API errors as misses in plan accuracy", () => {
    const selected = [repoCase(), repoCase({ id: "case-2" }), repoCase({ id: "case-3" })];
    const results = [
      {
        id: "fixture-case",
        repo: "owner/repo",
        ref: sha,
        status: "scored" as const,
        score: { correct: 6, total: 6, passed: true },
      },
      {
        id: "case-2",
        repo: "owner/repo",
        ref: sha,
        status: "error" as const,
        score: null,
        error: { detail: "API unavailable" },
      },
      {
        id: "case-3",
        repo: "owner/repo",
        ref: sha,
        status: "error" as const,
        score: null,
        error: { detail: "API unavailable" },
      },
    ];

    expect(summarize(selected, results)).toMatchObject({
      scored: 1,
      errors: 2,
      exactMatches: 1,
      planAccuracy: 1 / 3,
    });
  });
});
