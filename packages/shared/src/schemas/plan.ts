// ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
// │ STUB: AI-00 (Lyse) owns OnboardingPlan. It is copied as written from                        │
// │ docs/prd/03-ai-agent.md, "Onboarding planner". The apply body is BE-20's and AI-00's to      │
// │ settle together, so it is deliberately loose.                                                │
// └─────────────────────────────────────────────────────────────────────────────────────────────┘
import { z } from "zod";
import { Builder, DatabaseType, PlanConfidence, PlanVariableSource, ServiceType } from "../enums";
import { OnboardingPlanId } from "../ids";
import {
  BranchName,
  CommitSha,
  GithubLogin,
  GithubRepoName,
  Port,
  RepoWithBranch,
  VariableKey,
} from "./common";
import { ProjectDetail } from "./project";

export const PlanService = z.object({
  name: z.string(),
  rootDir: z.string(),
  type: ServiceType,
  builder: Builder,
  dockerfilePath: z.string().optional(),
  buildCommand: z.string().nullable(),
  startCommand: z.string().nullable(),
  port: Port,
  healthcheckPath: z.string(),
  rationale: z.string(),
});
export type PlanService = z.infer<typeof PlanService>;

export const PlanDatabase = z.object({
  type: DatabaseType,
  name: z.string(),
  envVar: VariableKey,
  rationale: z.string(),
});
export type PlanDatabase = z.infer<typeof PlanDatabase>;

export const PlanVariable = z.object({
  service: z.string(),
  key: VariableKey,
  source: PlanVariableSource,
  value: z.string().optional(),
  required: z.boolean(),
  description: z.string(),
});
export type PlanVariable = z.infer<typeof PlanVariable>;

/** `POST /agent/plans` → the plan, within 30 seconds (the route allows 60). */
export const OnboardingPlan = z.object({
  id: OnboardingPlanId,
  repo: RepoWithBranch.extend({ commitSha: CommitSha }),
  summary: z.string(),
  framework: z.string().nullable(),
  services: z.array(PlanService),
  databases: z.array(PlanDatabase),
  variables: z.array(PlanVariable),
  warnings: z.array(z.string()),
  confidence: PlanConfidence,
});
export type OnboardingPlan = z.infer<typeof OnboardingPlan>;

/** `POST /agent/plans`. */
export const CreatePlanBody = z.strictObject({
  owner: GithubLogin,
  repo: GithubRepoName,
  branch: BranchName.optional(),
});
export type CreatePlanBody = z.infer<typeof CreatePlanBody>;

/**
 * STUB (BE-20 with AI-00): `POST /agent/plans/:id/apply`. Still to decide: how the review screen's
 * edits, database toggles and typed values travel. Values the user types must never be stored in
 * `onboarding_plans.plan`, which isn't encrypted.
 */
export const ApplyPlanBody = z.looseObject({ projectName: z.string().optional() });
export type ApplyPlanBody = z.infer<typeof ApplyPlanBody>;

/** STUB (BE-20): the new project; the first deploys are under each service's latestDeployment. */
export const ApplyPlanResponse = z.looseObject({ project: ProjectDetail });
export type ApplyPlanResponse = z.infer<typeof ApplyPlanResponse>;
