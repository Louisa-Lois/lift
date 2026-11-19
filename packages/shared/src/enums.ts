import { z } from "zod";

// Every enum in docs/contracts.md and the PRDs. Each one is a values array (packages/db builds its
// Postgres enums from these), a Zod schema and a type of the same name. Values are lowercase.

/** A member's role: viewers read, editors read and write, owners also manage members. */
export const PROJECT_ROLES = ["owner", "editor", "viewer"] as const;
export const ProjectRole = z.enum(PROJECT_ROLES);
export type ProjectRole = z.infer<typeof ProjectRole>;

/** Roles the members routes can give. A project has exactly one owner, and ownership can't move. */
export const ASSIGNABLE_ROLES = ["editor", "viewer"] as const;
export const AssignableRole = z.enum(ASSIGNABLE_ROLES);
export type AssignableRole = z.infer<typeof AssignableRole>;

export const SERVICE_TYPES = ["web", "static"] as const;
export const ServiceType = z.enum(SERVICE_TYPES);
export type ServiceType = z.infer<typeof ServiceType>;

export const BUILDERS = ["railpack", "dockerfile"] as const;
export const Builder = z.enum(BUILDERS);
export type Builder = z.infer<typeof Builder>;

/** The deployment state machine is in docs/prd/01-backend-api.md, "Deployments". */
export const DEPLOYMENT_STATUSES = [
  "queued",
  "building",
  "deploying",
  "active",
  "failed",
  "canceled",
  "superseded",
] as const;
export const DeploymentStatus = z.enum(DEPLOYMENT_STATUSES);
export type DeploymentStatus = z.infer<typeof DeploymentStatus>;

/** Statuses a deployment is still moving through. */
export const IN_PROGRESS_DEPLOYMENT_STATUSES = [
  "queued",
  "building",
  "deploying",
] as const satisfies readonly DeploymentStatus[];

/** Statuses a deployment can be canceled from. */
export const CANCELABLE_DEPLOYMENT_STATUSES = [
  "queued",
  "building",
] as const satisfies readonly DeploymentStatus[];

/**
 * Who started a deployment. The API sets it: `push` from the webhook, `rollback` and `editor`
 * from their routes; otherwise from the credential: a session is `manual`, a `lift_pat_` token
 * is `cli`, the agent's `lift_svc_` token is `agent`.
 */
export const DEPLOYMENT_TRIGGERS = [
  "push",
  "manual",
  "rollback",
  "agent",
  "editor",
  "cli",
] as const;
export const DeploymentTrigger = z.enum(DEPLOYMENT_TRIGGERS);
export type DeploymentTrigger = z.infer<typeof DeploymentTrigger>;

/**
 * Why a deployment failed: the worker's six codes, plus `upstream_unavailable` when the API's
 * backstop fails a deployment that stopped reporting.
 */
export const DEPLOYMENT_ERROR_CODES = [
  "clone_failed",
  "build_failed",
  "build_timeout",
  "image_missing",
  "healthcheck_failed",
  "crashed",
  "upstream_unavailable",
] as const;
export const DeploymentErrorCode = z.enum(DEPLOYMENT_ERROR_CODES);
export type DeploymentErrorCode = z.infer<typeof DeploymentErrorCode>;

/**
 * Where a variable came from. `system` variables (PORT, LIFT_*) are injected at runtime and never
 * stored, so they appear only in the worker's runtime environment, never in the variables routes.
 */
export const VARIABLE_SOURCES = ["user", "database", "agent", "system"] as const;
export const VariableSource = z.enum(VARIABLE_SOURCES);
export type VariableSource = z.infer<typeof VariableSource>;

export const DATABASE_TYPES = ["postgres", "redis"] as const;
export const DatabaseType = z.enum(DATABASE_TYPES);
export type DatabaseType = z.infer<typeof DatabaseType>;

/**
 * `deleting` is the last status a database has: the API soft-deletes it when it enqueues
 * `deprovision_db`, and the worker reports only a failure.
 */
export const DATABASE_STATUSES = ["provisioning", "ready", "failed", "deleting"] as const;
export const DatabaseStatus = z.enum(DATABASE_STATUSES);
export type DatabaseStatus = z.infer<typeof DatabaseStatus>;

export const DOMAIN_KINDS = ["generated", "custom"] as const;
export const DomainKind = z.enum(DOMAIN_KINDS);
export type DomainKind = z.infer<typeof DomainKind>;

/** Generated domains start `active`; custom ones start `pending` until verified. */
export const DOMAIN_STATUSES = ["pending", "active", "failed"] as const;
export const DomainStatus = z.enum(DOMAIN_STATUSES);
export type DomainStatus = z.infer<typeof DomainStatus>;

export const ACTOR_TYPES = ["user", "agent", "system", "worker"] as const;
export const ActorType = z.enum(ACTOR_TYPES);
export type ActorType = z.infer<typeof ActorType>;

export const TOKEN_SCOPES = ["read", "deploy", "admin"] as const;
export const TokenScope = z.enum(TOKEN_SCOPES);
export type TokenScope = z.infer<typeof TokenScope>;

export const CLI_LOGIN_STATUSES = ["pending", "approved", "denied", "expired"] as const;
export const CliLoginStatus = z.enum(CLI_LOGIN_STATUSES);
export type CliLoginStatus = z.infer<typeof CliLoginStatus>;

export const PLAN_STATUSES = ["draft", "applied", "discarded"] as const;
export const PlanStatus = z.enum(PLAN_STATUSES);
export type PlanStatus = z.infer<typeof PlanStatus>;

export const LOG_STREAMS = ["build", "deploy", "runtime", "system"] as const;
export const LogStream = z.enum(LOG_STREAMS);
export type LogStream = z.infer<typeof LogStream>;

export const METRICS_WINDOWS = ["1h", "6h", "24h"] as const;
export const MetricsWindow = z.enum(METRICS_WINDOWS);
export type MetricsWindow = z.infer<typeof MetricsWindow>;

/**
 * Event types on the project activity stream and in the `events` table: the eight in
 * docs/contracts.md, plus six agreed in BE-00 so every state change has a type. Clients ignore
 * types they don't know, so adding one later is an additive change.
 */
export const PROJECT_EVENT_TYPES = [
  "deployment.created",
  "deployment.status_changed",
  "service.created",
  "service.updated",
  "service.deleted",
  "service.restarted",
  "database.status_changed",
  "variables.changed",
  "project.updated",
  "project.deleted",
  "member.changed",
  "agent.action_proposed",
  "agent.action_completed",
  "diagnosis.created",
  "editor.committed",
] as const;
export const ProjectEventType = z.enum(PROJECT_EVENT_TYPES);
export type ProjectEventType = z.infer<typeof ProjectEventType>;

// ── WS3 (AI agent) ──────────────────────────────────────────────────────────────────────────────
// Values copied from docs/contracts.md and docs/prd/03-ai-agent.md. Lyse owns these in AI-00.

export const AGENT_SESSION_KINDS = ["onboarding", "autofix", "chat", "watcher"] as const;
export const AgentSessionKind = z.enum(AGENT_SESSION_KINDS);
export type AgentSessionKind = z.infer<typeof AgentSessionKind>;

/** The autofix classifier's categories (03, "Autofix", step 2). */
export const FAILURE_CATEGORIES = [
  "missing_env_var",
  "wrong_port",
  "wrong_start_command",
  "wrong_build_command",
  "node_version",
  "python_version",
  "missing_dependency",
  "lockfile_mismatch",
  "healthcheck_timeout",
  "out_of_memory",
  "code_error",
  "unknown",
] as const;
export const FailureCategory = z.enum(FAILURE_CATEGORIES);
export type FailureCategory = z.infer<typeof FailureCategory>;

export const DIAGNOSIS_STATUSES = ["fixed", "proposed", "needs_human"] as const;
export const DiagnosisStatus = z.enum(DIAGNOSIS_STATUSES);
export type DiagnosisStatus = z.infer<typeof DiagnosisStatus>;

export const PLAN_CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export const PlanConfidence = z.enum(PLAN_CONFIDENCE_LEVELS);
export type PlanConfidence = z.infer<typeof PlanConfidence>;

/** Where a planned variable's value comes from (03, "Onboarding planner"). */
export const PLAN_VARIABLE_SOURCES = ["database", "generated", "user", "default"] as const;
export const PlanVariableSource = z.enum(PLAN_VARIABLE_SOURCES);
export type PlanVariableSource = z.infer<typeof PlanVariableSource>;

/** Events on the chat reply stream (03, "Ops chat"). */
export const CHAT_EVENT_TYPES = [
  "text_delta",
  "tool_call",
  "approval_required",
  "tool_result",
  "done",
] as const;
export const ChatEventType = z.enum(CHAT_EVENT_TYPES);
export type ChatEventType = z.infer<typeof ChatEventType>;
