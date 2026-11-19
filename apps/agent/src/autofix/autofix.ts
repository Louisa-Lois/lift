import Anthropic from "@anthropic-ai/sdk";
import {
  AUTOFIX_MAX_FIXES,
  type CreateDiagnosisBody,
  type Diagnosis,
  type FailureCategory,
  LiftApiError,
} from "@lift/shared";
import type { FastifyBaseLogger } from "fastify";
import type { AutofixApi } from "../internal-api";
import type { LiftApi } from "../lift-api";
import { BudgetSpent, type Llm, newTask, TooManyCalls } from "../llm";
import type { Prompts } from "../prompts";
import { gatherFailure } from "./gather";
import { type Classification, classify, proposeFix } from "./model";

/** An attempt has three minutes: nobody is waiting on it, but its card is. */
export const AUTOFIX_TIME_MS = 180_000;

/** Failures autofix tries to fix (PRD 03, "Autofix", step 3); others get a diagnosis only. */
export const CONFIG_CATEGORIES: ReadonlySet<FailureCategory> = new Set<FailureCategory>([
  "missing_env_var",
  "wrong_port",
  "wrong_start_command",
  "wrong_build_command",
  "node_version",
  "python_version",
  "healthcheck_timeout",
  "out_of_memory",
]);

export interface AutofixDeps {
  llm: Llm;
  prompts: Prompts;
  internal: AutofixApi;
  /** The public API as one user (read-only), for the log and the repo's files. */
  apiAs: (userId: string) => LiftApi;
  log: FastifyBaseLogger;
}

/**
 * What autofix says about one failure, as the body for the API (AI-04, AI-06). Every limit is
 * code, checked before any model call where it can be:
 * - after three fixes in a chain, a person decides (no model call);
 * - the same category as the failure the last fix was for means the fix didn't work;
 * - code problems and unknown failures get a diagnosis only (patches are AI-07);
 * - a spent budget, a refusal, or a model or API error still writes a diagnosis, so the
 *   deployment page never waits for one forever.
 * Null when there's nothing to do: the deployment isn't failed, or autofix was turned off.
 */
export async function diagnoseFailure(
  deps: AutofixDeps,
  deploymentId: string,
): Promise<CreateDiagnosisBody | null> {
  const context = await deps.internal.context(deploymentId);
  if (context.deployment.status !== "failed" || !context.service.autofix) return null;
  const nothing = (category: FailureCategory, summary: string, evidence: number[] = []) => ({
    deploymentId,
    category,
    summary,
    evidence,
    changes: [],
    proposals: [],
  });
  if (context.chain.attempt > AUTOFIX_MAX_FIXES) {
    return nothing(
      "unknown",
      `Lift made ${AUTOFIX_MAX_FIXES} fixes in a row and this deployment still failed, so a person needs to look.`,
    );
  }

  const task = newTask({ kind: "project", id: context.service.projectId }, AUTOFIX_TIME_MS);
  let classification: Classification | null = null;
  try {
    const failure = await gatherFailure(deps.apiAs(context.actAs), context);
    classification = await classify(deps, task, failure);
    if (!classification) {
      return nothing(
        "unknown",
        "The assistant couldn't tell what went wrong; the log has the details.",
      );
    }
    const { category, summary, evidence } = classification;
    deps.log.info({ deploymentId, category, attempt: context.chain.attempt }, "autofix classified");
    if (context.chain.previousCategory === category) {
      return nothing(
        category,
        `${summary} It's the same kind of failure Lift's last fix was for, so it stopped there.`,
        evidence,
      );
    }
    if (!CONFIG_CATEGORIES.has(category)) return nothing(category, summary, evidence);
    const fix = await proposeFix(deps, task, failure, classification);
    if (!fix) return nothing(category, summary, evidence);
    return { deploymentId, category, ...fix };
  } catch (error) {
    const category = classification?.category ?? "unknown";
    if (error instanceof BudgetSpent) {
      return nothing(
        category,
        "Today's AI budget for this project is spent, so the assistant didn't look at this failure.",
      );
    }
    if (
      error instanceof TooManyCalls ||
      error instanceof LiftApiError ||
      error instanceof Anthropic.APIError
    ) {
      deps.log.warn({ err: error, deploymentId }, "autofix couldn't finish");
      return nothing(category, "The assistant couldn't finish looking at this failure.");
    }
    throw error;
  }
}

/**
 * The `autofix` job: diagnose, then write the diagnosis, which makes the API apply the allowed
 * changes and redeploy. If the API refuses a change its own check doesn't allow, the diagnosis is
 * written again with every change as a proposal; one that already exists is left alone.
 */
export async function runAutofix(
  deps: AutofixDeps,
  deploymentId: string,
): Promise<Diagnosis | null> {
  const body = await diagnoseFailure(deps, deploymentId);
  if (!body) return null;
  try {
    return await deps.internal.diagnose(body);
  } catch (error) {
    if (error instanceof LiftApiError && error.status === 409) return null;
    if (error instanceof LiftApiError && error.status === 400 && body.changes.length > 0) {
      deps.log.warn({ deploymentId, detail: error.detail }, "the API refused autofix's changes");
      return await deps.internal.diagnose({
        ...body,
        changes: [],
        proposals: [...body.changes, ...body.proposals].slice(0, 10),
      });
    }
    throw error;
  }
}
