// ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
// │ AI-00 (Lyse) owns OnboardingPlan. It is copied as written from docs/prd/03-ai-agent.md,      │
// │ "Onboarding planner". BE-20 defined the apply body for the plan review screen (FE-14).       │
// └─────────────────────────────────────────────────────────────────────────────────────────────┘
import { z } from "zod";
import { Builder, DatabaseType, PlanConfidence, PlanVariableSource, ServiceType } from "../enums";
import { OnboardingPlanId, ProjectId, ServiceId } from "../ids";
import {
  BranchName,
  CommitSha,
  GithubLogin,
  GithubRepoName,
  Port,
  RepoWithBranch,
  ResourceName,
  VariableKey,
} from "./common";
import { ProjectDetail } from "./project";
import { ServiceSettings } from "./service";
import { VARIABLE_VALUE_MAX_LENGTH } from "./variable";

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

/** `POST /agent/plans`. Without `branch`, the repo's default branch. */
export const CreatePlanBody = z.strictObject({
  owner: GithubLogin,
  repo: GithubRepoName,
  branch: BranchName.optional(),
});
export type CreatePlanBody = z.infer<typeof CreatePlanBody>;

/** What the planner fills: the plan without its ID (the API's) and its repo (the request's). */
export const PlanDraft = OnboardingPlan.omit({ id: true, repo: true });
export type PlanDraft = z.infer<typeof PlanDraft>;

/**
 * The agent service's internal `POST /plans`: the API sends it with AGENT_SERVICE_TOKEN and the
 * user in X-Lift-User, once it has checked the user can read the repo and found the commit.
 */
export const AgentPlanRequest = z.strictObject({
  owner: GithubLogin,
  repo: GithubRepoName,
  branch: BranchName,
  commitSha: CommitSha,
});
export type AgentPlanRequest = z.infer<typeof AgentPlanRequest>;

/** The agent's answer: the plan before the API stores it and gives it an ID. */
export const AgentPlanResponse = OnboardingPlan.omit({ id: true });
export type AgentPlanResponse = z.infer<typeof AgentPlanResponse>;

/** A value the user typed (a `user` variable) or changed (a `default` one) on the review screen. */
export const PlanValue = z.strictObject({
  service: z.string().min(1),
  key: VariableKey,
  value: z.string().min(1).max(VARIABLE_VALUE_MAX_LENGTH),
});
export type PlanValue = z.infer<typeof PlanValue>;

/**
 * `POST /agent/plans/:id/apply` (BE-20): the review screen's edits. `databases` names the plan's
 * databases left on. Values go only into the encrypted variables, never into the stored plan.
 */
export const ApplyPlanBody = z.strictObject({
  /** Adds the service to this project (editors); without it, Lift creates a project. */
  projectId: ProjectId.optional(),
  /** The new project's name: the repo's name by default. Ignored with `projectId`. */
  projectName: ResourceName.optional(),
  /** Changes to the plan's service. */
  service: ServiceSettings.pick({
    name: true,
    rootDir: true,
    buildCommand: true,
    startCommand: true,
    port: true,
    healthcheckPath: true,
  })
    .partial()
    .optional(),
  databases: z.array(z.string().min(1)).max(5),
  values: z.array(PlanValue).max(200),
});
export type ApplyPlanBody = z.infer<typeof ApplyPlanBody>;

/**
 * The project the plan created or joined. The first deployment is the new service's
 * `latestDeployment`, and `serviceId` says which service that is.
 */
export const ApplyPlanResponse = z.object({ project: ProjectDetail, serviceId: ServiceId });
export type ApplyPlanResponse = z.infer<typeof ApplyPlanResponse>;
