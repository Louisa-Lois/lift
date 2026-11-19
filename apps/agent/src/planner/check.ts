import {
  HealthcheckPath,
  isPlaceholder,
  isReservedVariableKey,
  looksSecret,
  PlanDraft,
  type PlanVariable,
  ResourceName,
  RootDir,
  VariableKey,
} from "@lift/shared";
import { z } from "zod";

/**
 * What the model fills (structured output). It's looser than `PlanDraft` on purpose: plain types
 * the output format can express, with Lift's rules checked in code below. There's no builder
 * (Lift builds with Railpack) and no variable `service` (one service per repo).
 */
export const ModelPlan = z.object({
  summary: z.string(),
  framework: z.string().nullable(),
  services: z.array(
    z.object({
      name: z.string(),
      rootDir: z.string(),
      type: z.enum(["web", "static"]),
      buildCommand: z.string().nullable(),
      startCommand: z.string().nullable(),
      port: z.number().int(),
      healthcheckPath: z.string(),
      rationale: z.string(),
    }),
  ),
  databases: z.array(
    z.object({
      type: z.enum(["postgres", "redis"]),
      name: z.string(),
      envVar: z.string(),
      rationale: z.string(),
    }),
  ),
  variables: z.array(
    z.object({
      key: z.string(),
      source: z.enum(["database", "generated", "user", "default"]),
      value: z.string().nullable(),
      required: z.boolean(),
      description: z.string(),
    }),
  ),
  warnings: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low"]),
});
export type ModelPlan = z.infer<typeof ModelPlan>;

/** What Lift knows about the repo itself, to check the plan against. */
export interface RepoFacts {
  name: string;
  /** Every file path in the tree that was read. */
  paths: string[];
}

export interface CheckedPlan {
  draft: PlanDraft;
  /** Corrections Lift made, shown to the user with the model's own warnings. */
  warnings: string[];
  /** What Lift can't correct by itself: the model gets one chance to fix these. */
  problems: string[];
}

const COMMAND_MAX = 1000;
const LIFT_DATABASE_VARIABLE = "DATABASE_URL";

function command(value: string | null, field: string, problems: string[]): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") return null;
  if (trimmed.length > COMMAND_MAX)
    problems.push(`${field}: longer than ${COMMAND_MAX} characters`);
  return trimmed;
}

function name(value: string, fallback: string): string {
  const parsed = ResourceName.safeParse(value.trim().slice(0, 64));
  return parsed.success ? parsed.data : fallback.slice(0, 64);
}

/**
 * PRD 03's deterministic checks on the model's plan. Lift corrects what it safely can, with a
 * warning, and returns the rest as problems for one repair:
 * - one service, built with Railpack, on a port from 1024 to 65535, with a health path that
 *   starts with `/` and a root directory that exists;
 * - Postgres only, one at most, always as DATABASE_URL;
 * - no PORT or LIFT_* variables, no secret in any value, a description on every `user` variable.
 */
export function checkPlan(answer: ModelPlan, facts: RepoFacts): CheckedPlan {
  const warnings: string[] = [];
  const problems: string[] = [];

  // One service per repo (several, in a monorepo, is on the cut list).
  const [first, ...extra] = answer.services;
  if (!first) {
    return {
      draft: emptyDraft(answer),
      warnings,
      problems: ["services: the plan needs exactly one service"],
    };
  }
  if (extra.length > 0) {
    warnings.push(
      `Lift deploys one service per repo for now, so it planned ${first.name} and left out ${extra
        .map((service) => service.name)
        .join(", ")}.`,
    );
  }
  const serviceName = name(first.name, facts.name);
  let rootDir =
    first.rootDir
      .trim()
      .replace(/^\.\/+/, "")
      .replace(/\/+$/, "") || ".";
  const rootExists = rootDir === "." || facts.paths.some((path) => path.startsWith(`${rootDir}/`));
  if (!RootDir.safeParse(rootDir).success || !rootExists) {
    warnings.push(`The repo has no folder ${first.rootDir}, so Lift builds from the root.`);
    rootDir = ".";
  }
  if (first.port < 1024 || first.port > 65_535) {
    problems.push(`services.0.port: ${first.port} isn't between 1024 and 65535`);
  }
  let healthcheckPath = first.healthcheckPath.trim() || "/";
  if (!healthcheckPath.startsWith("/")) healthcheckPath = `/${healthcheckPath}`;
  if (!HealthcheckPath.safeParse(healthcheckPath).success) healthcheckPath = "/";
  if (facts.paths.includes("Dockerfile")) {
    warnings.push("Lift builds with Railpack for now, so the repo's Dockerfile isn't used.");
  }

  // Postgres only, one at most, as DATABASE_URL.
  const databases: PlanDraft["databases"] = [];
  for (const database of answer.databases) {
    if (database.type !== "postgres") {
      warnings.push(`Lift doesn't run Redis yet, so ${database.name} was left out.`);
      continue;
    }
    if (databases.length > 0) {
      warnings.push(`Lift gives a project one Postgres, so ${database.name} was left out.`);
      continue;
    }
    if (database.envVar !== LIFT_DATABASE_VARIABLE) {
      warnings.push(
        `Lift passes Postgres as ${LIFT_DATABASE_VARIABLE}, not ${database.envVar}: read that one in the app.`,
      );
    }
    databases.push({
      type: "postgres",
      name: name(database.name, `${serviceName}-db`),
      envVar: LIFT_DATABASE_VARIABLE,
      rationale: database.rationale,
    });
  }

  const variables: PlanVariable[] = [];
  const seen = new Set<string>();
  for (const variable of answer.variables) {
    const key = variable.key.trim();
    if (!VariableKey.safeParse(key).success) {
      warnings.push(`${key} isn't a valid variable name, so it was left out.`);
      continue;
    }
    if (isReservedVariableKey(key)) {
      warnings.push(`Lift sets ${key} itself, so it isn't in the plan.`);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const base = { service: serviceName, key, required: variable.required };
    const description = variable.description.trim();
    if (variable.source === "database") {
      if (databases.length > 0 && key === LIFT_DATABASE_VARIABLE) {
        variables.push({ ...base, source: "database", description });
      } else {
        warnings.push(`No Lift database fills ${key}, so you provide it.`);
        variables.push({
          ...base,
          source: "user",
          description: description || `Where ${key} points.`,
        });
      }
      continue;
    }
    if (variable.source === "default") {
      const value = variable.value?.trim() ?? "";
      if (value !== "" && !isPlaceholder(value) && !looksSecret(key, value)) {
        variables.push({ ...base, source: "default", value, description });
        continue;
      }
      if (value !== "") {
        warnings.push(
          isPlaceholder(value)
            ? `${key}'s example value is a placeholder, so you provide it.`
            : `${key} looks like a secret, so you provide it.`,
        );
      }
      variables.push({
        ...base,
        source: "user",
        description: description || `The value of ${key}.`,
      });
      continue;
    }
    // generated and user variables never carry a value: Lift or the user fills them.
    if (variable.source === "user" && description === "") {
      problems.push(`variables.${key}: a variable the user provides needs a description`);
    }
    variables.push({ ...base, source: variable.source, description });
  }
  if (databases.length > 0 && !seen.has(LIFT_DATABASE_VARIABLE)) {
    variables.unshift({
      service: serviceName,
      key: LIFT_DATABASE_VARIABLE,
      source: "database",
      required: true,
      description: "Lift's Postgres, filled in once it's ready.",
    });
  }

  const draft = {
    summary: answer.summary.trim() || `A plan for ${facts.name}.`,
    framework: answer.framework?.trim() || null,
    services: [
      {
        name: serviceName,
        rootDir,
        type: first.type,
        builder: "railpack" as const,
        buildCommand: command(first.buildCommand, "services.0.buildCommand", problems),
        startCommand: command(first.startCommand, "services.0.startCommand", problems),
        port: first.port,
        healthcheckPath,
        rationale: first.rationale,
      },
    ],
    databases,
    variables,
    warnings: answer.warnings.map((warning) => warning.trim()).filter(Boolean),
    confidence: answer.confidence,
  };
  const parsed = PlanDraft.safeParse(draft);
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      problems.push(`${issue.path.join(".")}: ${issue.message}`);
    return { draft: emptyDraft(answer), warnings, problems };
  }
  return { draft: parsed.data, warnings, problems };
}

/** A placeholder draft for answers with problems; it's never returned to the API. */
function emptyDraft(answer: ModelPlan): PlanDraft {
  return {
    summary: answer.summary,
    framework: null,
    services: [],
    databases: [],
    variables: [],
    warnings: [],
    confidence: "low",
  };
}
