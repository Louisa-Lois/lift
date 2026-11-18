/**
 * The platform database schema (Drizzle ORM): the v1 tables from docs/prd/01-backend-api.md,
 * "Tables", plus the decisions recorded in BE-00. `pnpm db:generate` writes the SQL migration into
 * packages/db/migrations. Columns are defined in camelCase; `casing: "snake_case"` maps `githubId`
 * to `github_id`. Migrations change only through the interface rule.
 */
import {
  ACTOR_TYPES,
  BUILDERS,
  CLI_LOGIN_STATUSES,
  DATABASE_STATUSES,
  DATABASE_TYPES,
  DEPLOYMENT_ERROR_CODES,
  DEPLOYMENT_STATUSES,
  DEPLOYMENT_TRIGGERS,
  DOMAIN_KINDS,
  DOMAIN_STATUSES,
  PLAN_STATUSES,
  PROJECT_ROLES,
  SERVICE_TYPES,
  TOKEN_SCOPES,
  VARIABLE_SOURCES,
} from "@lift/shared";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Raw bytes: `*_enc` columns (AES-256-GCM, stored as iv | tag | ciphertext) and Yjs state. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

const timestamptz = () => timestamp({ withTimezone: true, mode: "date" });
const createdAt = () => timestamptz().notNull().defaultNow();

// Postgres enums, built from the value arrays in @lift/shared so the two can't drift. Adding a
// value is an additive migration (ALTER TYPE … ADD VALUE). Agent columns stay text until AI-00.
export const projectRoleEnum = pgEnum("project_role", PROJECT_ROLES);
export const serviceTypeEnum = pgEnum("service_type", SERVICE_TYPES);
export const builderEnum = pgEnum("builder", BUILDERS);
export const deploymentStatusEnum = pgEnum("deployment_status", DEPLOYMENT_STATUSES);
export const deploymentTriggerEnum = pgEnum("deployment_trigger", DEPLOYMENT_TRIGGERS);
export const deploymentErrorCodeEnum = pgEnum("deployment_error_code", DEPLOYMENT_ERROR_CODES);
export const variableSourceEnum = pgEnum("variable_source", VARIABLE_SOURCES);
export const databaseTypeEnum = pgEnum("database_type", DATABASE_TYPES);
export const databaseStatusEnum = pgEnum("database_status", DATABASE_STATUSES);
export const domainKindEnum = pgEnum("domain_kind", DOMAIN_KINDS);
export const domainStatusEnum = pgEnum("domain_status", DOMAIN_STATUSES);
export const actorTypeEnum = pgEnum("actor_type", ACTOR_TYPES);
export const tokenScopeEnum = pgEnum("token_scope", TOKEN_SCOPES);
export const cliLoginStatusEnum = pgEnum("cli_login_status", CLI_LOGIN_STATUSES);
export const planStatusEnum = pgEnum("plan_status", PLAN_STATUSES);

// ── Accounts ──────────────────────────────────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: text().primaryKey(),
    githubId: bigint({ mode: "number" }).notNull().unique("users_github_id_unique"),
    login: text().notNull(),
    name: text(),
    email: text(),
    avatarUrl: text().notNull(),
    githubTokenEnc: bytea().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("users_login_index").on(t.login)],
);

export const sessions = pgTable("sessions", {
  /** SHA-256 (hex) of the cookie value; the cookie itself is never stored. 14-day sliding expiry. */
  id: text().primaryKey(),
  userId: text()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamptz().notNull(),
  ip: text(),
  userAgent: text(),
  createdAt: createdAt(),
});

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text().notNull(),
    prefix: text().notNull(),
    tokenHash: text().notNull(),
    scopes: tokenScopeEnum().array().notNull(),
    projectId: text().references(() => projects.id),
    lastUsedAt: timestamptz(),
    revokedAt: timestamptz(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("api_tokens_token_hash_index").on(t.tokenHash)],
);

export const cliLogins = pgTable(
  "cli_logins",
  {
    id: text().primaryKey(),
    code: text().notNull(),
    pollSecretHash: text().notNull(),
    userId: text().references(() => users.id, { onDelete: "cascade" }),
    tokenId: text().references(() => apiTokens.id, { onDelete: "set null" }),
    status: cliLoginStatusEnum().notNull().default("pending"),
    expiresAt: timestamptz().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("cli_logins_code_index").on(t.code)],
);

// ── Projects and services ─────────────────────────────────────────────────────────────────────

export const projects = pgTable("projects", {
  id: text().primaryKey(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  ownerId: text()
    .notNull()
    .references(() => users.id),
  deletedAt: timestamptz(),
  createdAt: createdAt(),
});

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: projectRoleEnum().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
);

export const services = pgTable(
  "services",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    name: text().notNull(),
    slug: text().notNull(),
    type: serviceTypeEnum().notNull(),
    repoOwner: text().notNull(),
    repoName: text().notNull(),
    branch: text().notNull(),
    rootDir: text().notNull(),
    builder: builderEnum().notNull(),
    dockerfilePath: text(),
    buildCommand: text(),
    startCommand: text(),
    port: integer().notNull().default(3000),
    healthcheckPath: text().notNull().default("/"),
    cpu: real().notNull().default(0.5),
    memoryMb: integer().notNull().default(512),
    subdomain: text().notNull().unique(),
    autofix: boolean().notNull().default(true),
    webhookId: bigint({ mode: "number" }),
    webhookSecretEnc: bytea(),
    deletedAt: timestamptz(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("services_project_id_slug_index").on(t.projectId, t.slug)],
);

// ── Deployments ───────────────────────────────────────────────────────────────────────────────

export const deployments = pgTable(
  "deployments",
  {
    id: text().primaryKey(),
    serviceId: text()
      .notNull()
      .references(() => services.id),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    status: deploymentStatusEnum().notNull(),
    trigger: deploymentTriggerEnum().notNull(),
    commitSha: text().notNull(),
    commitMessage: text(),
    commitAuthor: text(),
    imageTag: text(),
    containerId: text(),
    rollbackOf: text().references((): AnyPgColumn => deployments.id),
    errorCode: deploymentErrorCodeEnum(),
    errorMessage: text(),
    createdByUserId: text().references(() => users.id),
    createdByActionId: text().references((): AnyPgColumn => agentActions.id),
    queuedAt: timestamptz().notNull().defaultNow(),
    startedAt: timestamptz(),
    finishedAt: timestamptz(),
    createdAt: createdAt(),
  },
  (t) => [
    index("deployments_service_id_queued_at_index").on(t.serviceId, t.queuedAt.desc().nullsFirst()),
    // Webhook de-duplication: one push or editor deployment per commit; a push delivered twice,
    // or the push that follows an editor commit, conflicts and is skipped.
    uniqueIndex("deployments_push_editor_dedup")
      .on(t.serviceId, t.commitSha)
      .where(sql`${t.trigger} in ('push', 'editor')`),
    // "Only one deployment per service is active": supersede the old one before activating.
    uniqueIndex("deployments_one_active_per_service")
      .on(t.serviceId)
      .where(sql`${t.status} = 'active'`),
  ],
);

/** The per-deployment timeline. */
export const deploymentEvents = pgTable("deployment_events", {
  id: text().primaryKey(),
  deploymentId: text()
    .notNull()
    .references(() => deployments.id, { onDelete: "cascade" }),
  status: deploymentStatusEnum().notNull(),
  message: text(),
  at: timestamptz().notNull(),
  createdAt: createdAt(),
});

/** Copied from Redis when a deployment ends; at most 1 MB. */
export const buildLogs = pgTable("build_logs", {
  deploymentId: text()
    .primaryKey()
    .references(() => deployments.id, { onDelete: "cascade" }),
  content: text().notNull(),
  createdAt: createdAt(),
});

// ── Variables, databases, domains ─────────────────────────────────────────────────────────────

export const variables = pgTable(
  "variables",
  {
    id: text().primaryKey(),
    serviceId: text()
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    key: text().notNull(),
    valueEnc: bytea().notNull(),
    source: variableSourceEnum().notNull(),
    /** The database this value came from (source `database`), so deleting one removes only its own. */
    databaseId: text().references(() => databases.id),
    updatedAt: timestamptz().notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("variables_service_id_key_index").on(t.serviceId, t.key)],
);

export const databases = pgTable("databases", {
  id: text().primaryKey(),
  projectId: text()
    .notNull()
    .references(() => projects.id),
  type: databaseTypeEnum().notNull(),
  name: text().notNull(),
  status: databaseStatusEnum().notNull(),
  host: text(),
  port: integer(),
  /** For Postgres, the database and role are both named after the database ID. */
  dbName: text(),
  username: text(),
  passwordEnc: bytea().notNull(),
  /** Where the connection string goes: DATABASE_URL, REDIS_URL, or the key a plan chose. */
  envVar: text().notNull(),
  deletedAt: timestamptz(),
  createdAt: createdAt(),
});

export const domains = pgTable("domains", {
  id: text().primaryKey(),
  serviceId: text()
    .notNull()
    .references(() => services.id),
  hostname: text().notNull().unique(),
  kind: domainKindEnum().notNull(),
  status: domainStatusEnum().notNull(),
  verifiedAt: timestamptz(),
  createdAt: createdAt(),
});

// ── Activity, metrics ─────────────────────────────────────────────────────────────────────────

/** The audit log; every row is also sent on the project stream. */
export const events = pgTable(
  "events",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    actorType: actorTypeEnum().notNull(),
    actorId: text(),
    type: text().notNull(),
    data: jsonb().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("events_project_id_created_at_index").on(t.projectId, t.createdAt.desc().nullsFirst()),
  ],
);

/** One sample per container every 15 seconds; kept 7 days. */
export const metricSamples = pgTable(
  "metric_samples",
  {
    serviceId: text()
      .notNull()
      .references(() => services.id),
    ts: timestamptz().notNull(),
    cpuPct: real().notNull(),
    memMb: real().notNull(),
    netRxKb: real().notNull(),
    netTxKb: real().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("metric_samples_service_id_ts_index").on(t.serviceId, t.ts)],
);

// ── AI agent: schema with WS3, storage here so the API can serve it ──────────────────────────
// Drafts for AI-00 (Lyse): mostly text and jsonb, so the shapes can settle without migrations.

export const onboardingPlans = pgTable("onboarding_plans", {
  id: text().primaryKey(),
  userId: text()
    .notNull()
    .references(() => users.id),
  projectId: text().references(() => projects.id),
  repoOwner: text().notNull(),
  repoName: text().notNull(),
  commitSha: text().notNull(),
  /** The OnboardingPlan as JSON. Never holds values the user typed: this column isn't encrypted. */
  plan: jsonb().notNull(),
  status: planStatusEnum().notNull().default("draft"),
  createdAt: createdAt(),
});

export const agentSessions = pgTable("agent_sessions", {
  id: text().primaryKey(),
  /** Null for onboarding, which happens before the project exists. */
  projectId: text().references(() => projects.id),
  userId: text()
    .notNull()
    .references(() => users.id),
  kind: text().notNull(),
  createdAt: createdAt(),
});

export const agentMessages = pgTable("agent_messages", {
  id: text().primaryKey(),
  sessionId: text()
    .notNull()
    .references(() => agentSessions.id, { onDelete: "cascade" }),
  role: text().notNull(),
  content: jsonb().notNull(),
  createdAt: createdAt(),
});

export const agentActions = pgTable("agent_actions", {
  id: text().primaryKey(),
  sessionId: text().references(() => agentSessions.id),
  projectId: text().references(() => projects.id),
  kind: text().notNull(),
  tool: text().notNull(),
  args: jsonb().notNull(),
  status: text().notNull(),
  requiresApproval: boolean().notNull(),
  result: jsonb(),
  decidedByUserId: text().references(() => users.id),
  decidedAt: timestamptz(),
  createdAt: createdAt(),
});

export const diagnoses = pgTable("diagnoses", {
  id: text().primaryKey(),
  /** One diagnosis per failed deployment; a retry is a new deployment with its own. */
  deploymentId: text()
    .notNull()
    .unique("diagnoses_deployment_id_unique")
    .references(() => deployments.id),
  category: text().notNull(),
  summary: text().notNull(),
  evidence: jsonb().notNull(),
  actions: jsonb().notNull(),
  attempt: integer().notNull(),
  status: text().notNull(),
  createdAt: createdAt(),
});

// ── Live editor ───────────────────────────────────────────────────────────────────────────────

export const editorDocuments = pgTable(
  "editor_documents",
  {
    id: text().primaryKey(),
    serviceId: text()
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    path: text().notNull(),
    yjsState: bytea().notNull(),
    baseSha: text().notNull(),
    updatedAt: timestamptz().notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("editor_documents_service_id_path_index").on(t.serviceId, t.path)],
);

export const editorCommits = pgTable("editor_commits", {
  id: text().primaryKey(),
  serviceId: text()
    .notNull()
    .references(() => services.id),
  commitSha: text().notNull(),
  message: text().notNull(),
  paths: text().array().notNull(),
  authorUserId: text()
    .notNull()
    .references(() => users.id),
  /** Null only if the commit landed but its deployment couldn't be created. */
  deploymentId: text().references(() => deployments.id),
  createdAt: createdAt(),
});

// ── Evaluations (WS3) ─────────────────────────────────────────────────────────────────────────

export const evalRuns = pgTable("eval_runs", {
  id: text().primaryKey(),
  summary: jsonb().notNull(),
  createdAt: createdAt(),
});

export const evalResults = pgTable("eval_results", {
  id: text().primaryKey(),
  runId: text()
    .notNull()
    .references(() => evalRuns.id, { onDelete: "cascade" }),
  caseId: text().notNull(),
  deploymentId: text().references(() => deployments.id),
  outcome: jsonb().notNull(),
  createdAt: createdAt(),
});
