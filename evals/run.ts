import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Golden = {
  services: { type: "web" | "static"; port: number; startCommand: string | null }[];
  databases: string[];
  requiredVariables: string[];
};

type RepoCase = {
  id: string;
  repo: string;
  ref: string;
  stack: string;
  golden: Golden;
  breakage: unknown | null;
};

type Plan = {
  id: string;
  repo: { owner: string; name: string; branch: string; commitSha: string };
  summary: string;
  framework: string | null;
  services: {
    type: "web" | "static";
    port: number;
    startCommand: string | null;
  }[];
  databases: { type: string }[];
  variables: { key: string; required: boolean; source: string }[];
  warnings: string[];
  confidence: "high" | "medium" | "low";
};

type Dimension = { passed: boolean; expected: unknown; actual: unknown };
type CaseResult = {
  id: string;
  repo: string;
  ref: string;
  status: "scored" | "error";
  score: { correct: number; total: number; passed: boolean } | null;
  dimensions?: Record<string, Dimension>;
  plan?: {
    repo: Plan["repo"];
    framework: string | null;
    confidence: Plan["confidence"];
    services: Plan["services"];
    databases: Plan["databases"];
    variables: { key: string; required: boolean; source: string }[];
  };
  error?: string;
};

const here = dirname(fileURLToPath(import.meta.url));
const apiBase = new URL(process.env.LIFT_API_URL ?? "http://localhost:3000/api/v1");
apiBase.username = "";
apiBase.password = "";
apiBase.search = "";
apiBase.hash = "";
const apiUrl = apiBase.toString().replace(/\/$/, "");
const token = process.env.LIFT_TOKEN;

function options(argv: string[]) {
  let only: string | undefined;
  let concurrency = 3;
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i + 1];
    if (argv[i] === "--only" && value) {
      only = value;
      i += 1;
    } else if (argv[i] === "--concurrency" && value) {
      concurrency = Number(value);
      i += 1;
    } else if (argv[i] === "--help") {
      console.log("Usage: pnpm eval [--only case-id] [--concurrency 1..10]");
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete option: ${argv[i]}`);
    }
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10)
    throw new Error("--concurrency must be an integer from 1 through 10");
  return { only, concurrency };
}

function equalCommand(expected: string | null, actual: string | null): boolean {
  if (expected === null || actual === null) return expected === actual;
  return expected.trim().replace(/\s+/g, " ") === actual.trim().replace(/\s+/g, " ");
}

function score(golden: Golden, plan: Plan) {
  const expectedService = golden.services[0];
  const actualService = plan.services[0];
  const actualDatabases = [...new Set(plan.databases.map((database) => database.type))].sort();
  const expectedDatabases = [...new Set(golden.databases)].sort();
  const actualRequiredVariables = new Set(
    plan.variables.filter((variable) => variable.required).map((variable) => variable.key),
  );
  const missingVariables = golden.requiredVariables.filter(
    (key) => !actualRequiredVariables.has(key),
  );
  const dimensions: Record<string, Dimension> = {
    serviceCount: {
      passed: plan.services.length === golden.services.length,
      expected: golden.services.length,
      actual: plan.services.length,
    },
    serviceType: {
      passed: Boolean(expectedService && actualService?.type === expectedService.type),
      expected: expectedService?.type,
      actual: actualService?.type,
    },
    port: {
      passed: Boolean(expectedService && actualService?.port === expectedService.port),
      expected: expectedService?.port,
      actual: actualService?.port,
    },
    startCommand: {
      passed: Boolean(
        expectedService &&
          actualService &&
          equalCommand(expectedService.startCommand, actualService.startCommand),
      ),
      expected: expectedService?.startCommand,
      actual: actualService?.startCommand,
    },
    databases: {
      passed: JSON.stringify(actualDatabases) === JSON.stringify(expectedDatabases),
      expected: expectedDatabases,
      actual: actualDatabases,
    },
    requiredVariables: {
      passed: missingVariables.length === 0,
      expected: golden.requiredVariables,
      actual: [...actualRequiredVariables].sort(),
    },
  };
  const correct = Object.values(dimensions).filter((dimension) => dimension.passed).length;
  const total = Object.keys(dimensions).length;
  return { dimensions, score: { correct, total, passed: correct === total } };
}

async function planCase(testCase: RepoCase): Promise<CaseResult> {
  const [owner, repo] = testCase.repo.split("/");
  try {
    const response = await fetch(`${apiUrl}/agent/plans`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      // GitHub resolves a commit SHA through its commits/{ref} endpoint. Passing the pinned SHA
      // as the branch/ref keeps this run reproducible rather than following a moving default branch.
      body: JSON.stringify({ owner, repo, branch: testCase.ref }),
    });
    if (!response.ok) {
      return {
        id: testCase.id,
        repo: testCase.repo,
        ref: testCase.ref,
        status: "error",
        score: null,
        error: `Plan request failed with HTTP ${response.status}`,
      };
    }
    const plan = (await response.json()) as Plan;
    if (plan.repo.commitSha.toLowerCase() !== testCase.ref.toLowerCase()) {
      return {
        id: testCase.id,
        repo: testCase.repo,
        ref: testCase.ref,
        status: "error",
        score: null,
        error: `The API planned ${plan.repo.commitSha}, not the pinned commit`,
      };
    }
    const result = score(testCase.golden, plan);
    return {
      id: testCase.id,
      repo: testCase.repo,
      ref: testCase.ref,
      status: "scored",
      ...result,
      // Variable values are deliberately omitted from stored evaluation results.
      plan: {
        repo: plan.repo,
        framework: plan.framework,
        confidence: plan.confidence,
        services: plan.services.map(({ type, port, startCommand }) => ({
          type,
          port,
          startCommand,
        })),
        databases: plan.databases.map(({ type }) => ({ type })),
        variables: plan.variables.map(({ key, required, source }) => ({ key, required, source })),
      },
    };
  } catch (error) {
    return {
      id: testCase.id,
      repo: testCase.repo,
      ref: testCase.ref,
      status: "error",
      score: null,
      error: error instanceof Error ? error.message.slice(0, 300) : "Unknown request error",
    };
  }
}

async function main() {
  if (!token)
    throw new Error("Set LIFT_TOKEN to a Lift personal access token before running evals");
  const { only, concurrency } = options(process.argv.slice(2));
  const cases = JSON.parse(await readFile(resolve(here, "repos.json"), "utf8")) as RepoCase[];
  const healthyCases = cases.filter((testCase) => testCase.breakage === null);
  const selected = only ? healthyCases.filter((testCase) => testCase.id === only) : healthyCases;
  if (only && selected.length === 0)
    throw new Error(
      `No healthy case found with id ${only}; broken cases are not run by this healthy-only evaluator`,
    );
  if (selected.length === 0) throw new Error("No healthy cases are available to evaluate");

  const startedAt = new Date().toISOString();
  let cursor = 0;
  const results: CaseResult[] = [];
  const worker = async () => {
    while (cursor < selected.length) {
      const testCase = selected[cursor++];
      if (!testCase) return;
      console.log(`Planning ${testCase.id} (${testCase.repo} @ ${testCase.ref.slice(0, 7)})`);
      results.push(await planCase(testCase));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, worker));
  results.sort((a, b) => a.id.localeCompare(b.id));

  const scored = results.filter((result) => result.status === "scored");
  const passed = scored.filter((result) => result.score?.passed).length;
  const run = {
    startedAt,
    mode: "healthy-plan-only",
    apiUrl,
    counts: {
      healthyCases: selected.length,
      brokenCasesSkipped: cases.length - healthyCases.length,
      scored: scored.length,
      errors: results.length - scored.length,
      exactMatches: passed,
      planAccuracy: scored.length ? passed / scored.length : 0,
    },
    results,
  };
  const resultsDir = resolve(here, "results");
  await mkdir(resultsDir, { recursive: true });
  const file = resolve(resultsDir, `${run.startedAt.replaceAll(":", "-")}.json`);
  await writeFile(file, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  console.log(`Exact plan matches: ${passed}/${scored.length}; results saved to ${file}`);
  if (run.counts.errors > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
