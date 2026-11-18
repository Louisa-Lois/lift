CREATE TYPE "public"."actor_type" AS ENUM('user', 'agent', 'system', 'worker');--> statement-breakpoint
CREATE TYPE "public"."builder" AS ENUM('railpack', 'dockerfile');--> statement-breakpoint
CREATE TYPE "public"."cli_login_status" AS ENUM('pending', 'approved', 'denied', 'expired');--> statement-breakpoint
CREATE TYPE "public"."database_status" AS ENUM('provisioning', 'ready', 'failed', 'deleting');--> statement-breakpoint
CREATE TYPE "public"."database_type" AS ENUM('postgres', 'redis');--> statement-breakpoint
CREATE TYPE "public"."deployment_error_code" AS ENUM('clone_failed', 'build_failed', 'build_timeout', 'image_missing', 'healthcheck_failed', 'crashed', 'upstream_unavailable');--> statement-breakpoint
CREATE TYPE "public"."deployment_status" AS ENUM('queued', 'building', 'deploying', 'active', 'failed', 'canceled', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."deployment_trigger" AS ENUM('push', 'manual', 'rollback', 'agent', 'editor', 'cli');--> statement-breakpoint
CREATE TYPE "public"."domain_kind" AS ENUM('generated', 'custom');--> statement-breakpoint
CREATE TYPE "public"."domain_status" AS ENUM('pending', 'active', 'failed');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'applied', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."project_role" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."service_type" AS ENUM('web', 'static');--> statement-breakpoint
CREATE TYPE "public"."token_scope" AS ENUM('read', 'deploy', 'admin');--> statement-breakpoint
CREATE TYPE "public"."variable_source" AS ENUM('user', 'database', 'agent', 'system');--> statement-breakpoint
CREATE TABLE "agent_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"project_id" text,
	"kind" text NOT NULL,
	"tool" text NOT NULL,
	"args" jsonb NOT NULL,
	"status" text NOT NULL,
	"requires_approval" boolean NOT NULL,
	"result" jsonb,
	"decided_by_user_id" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" "token_scope"[] NOT NULL,
	"project_id" text,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build_logs" (
	"deployment_id" text PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cli_logins" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"poll_secret_hash" text NOT NULL,
	"user_id" text,
	"token_id" text,
	"status" "cli_login_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "databases" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"type" "database_type" NOT NULL,
	"name" text NOT NULL,
	"status" "database_status" NOT NULL,
	"host" text,
	"port" integer,
	"db_name" text,
	"username" text,
	"password_enc" "bytea" NOT NULL,
	"env_var" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"deployment_id" text NOT NULL,
	"status" "deployment_status" NOT NULL,
	"message" text,
	"at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"project_id" text NOT NULL,
	"status" "deployment_status" NOT NULL,
	"trigger" "deployment_trigger" NOT NULL,
	"commit_sha" text NOT NULL,
	"commit_message" text,
	"commit_author" text,
	"image_tag" text,
	"container_id" text,
	"rollback_of" text,
	"error_code" "deployment_error_code",
	"error_message" text,
	"created_by_user_id" text,
	"created_by_action_id" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diagnoses" (
	"id" text PRIMARY KEY NOT NULL,
	"deployment_id" text NOT NULL,
	"category" text NOT NULL,
	"summary" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"attempt" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnoses_deployment_id_unique" UNIQUE("deployment_id")
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"hostname" text NOT NULL,
	"kind" "domain_kind" NOT NULL,
	"status" "domain_status" NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domains_hostname_unique" UNIQUE("hostname")
);
--> statement-breakpoint
CREATE TABLE "editor_commits" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"commit_sha" text NOT NULL,
	"message" text NOT NULL,
	"paths" text[] NOT NULL,
	"author_user_id" text NOT NULL,
	"deployment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editor_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"path" text NOT NULL,
	"yjs_state" "bytea" NOT NULL,
	"base_sha" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_results" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"case_id" text NOT NULL,
	"deployment_id" text,
	"outcome" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_samples" (
	"service_id" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"cpu_pct" real NOT NULL,
	"mem_mb" real NOT NULL,
	"net_rx_kb" real NOT NULL,
	"net_tx_kb" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"commit_sha" text NOT NULL,
	"plan" jsonb NOT NULL,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "project_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"owner_id" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"type" "service_type" NOT NULL,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"branch" text NOT NULL,
	"root_dir" text NOT NULL,
	"builder" "builder" NOT NULL,
	"dockerfile_path" text,
	"build_command" text,
	"start_command" text,
	"port" integer DEFAULT 3000 NOT NULL,
	"healthcheck_path" text DEFAULT '/' NOT NULL,
	"cpu" real DEFAULT 0.5 NOT NULL,
	"memory_mb" integer DEFAULT 512 NOT NULL,
	"subdomain" text NOT NULL,
	"autofix" boolean DEFAULT true NOT NULL,
	"webhook_id" bigint,
	"webhook_secret_enc" "bytea",
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_subdomain_unique" UNIQUE("subdomain")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"github_id" bigint NOT NULL,
	"login" text NOT NULL,
	"name" text,
	"email" text,
	"avatar_url" text NOT NULL,
	"github_token_enc" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
CREATE TABLE "variables" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"key" text NOT NULL,
	"value_enc" "bytea" NOT NULL,
	"source" "variable_source" NOT NULL,
	"database_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_logs" ADD CONSTRAINT "build_logs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_logins" ADD CONSTRAINT "cli_logins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_logins" ADD CONSTRAINT "cli_logins_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "databases" ADD CONSTRAINT "databases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_events" ADD CONSTRAINT "deployment_events_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_rollback_of_deployments_id_fk" FOREIGN KEY ("rollback_of") REFERENCES "public"."deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_created_by_action_id_agent_actions_id_fk" FOREIGN KEY ("created_by_action_id") REFERENCES "public"."agent_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_commits" ADD CONSTRAINT "editor_commits_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_commits" ADD CONSTRAINT "editor_commits_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_commits" ADD CONSTRAINT "editor_commits_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_documents" ADD CONSTRAINT "editor_documents_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_results" ADD CONSTRAINT "eval_results_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_results" ADD CONSTRAINT "eval_results_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_samples" ADD CONSTRAINT "metric_samples_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_plans" ADD CONSTRAINT "onboarding_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_plans" ADD CONSTRAINT "onboarding_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variables" ADD CONSTRAINT "variables_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variables" ADD CONSTRAINT "variables_database_id_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."databases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_token_hash_index" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "cli_logins_code_index" ON "cli_logins" USING btree ("code");--> statement-breakpoint
CREATE INDEX "deployments_service_id_queued_at_index" ON "deployments" USING btree ("service_id","queued_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "deployments_push_editor_dedup" ON "deployments" USING btree ("service_id","commit_sha") WHERE "deployments"."trigger" in ('push', 'editor');--> statement-breakpoint
CREATE UNIQUE INDEX "deployments_one_active_per_service" ON "deployments" USING btree ("service_id") WHERE "deployments"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "editor_documents_service_id_path_index" ON "editor_documents" USING btree ("service_id","path");--> statement-breakpoint
CREATE INDEX "events_project_id_created_at_index" ON "events" USING btree ("project_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "metric_samples_service_id_ts_index" ON "metric_samples" USING btree ("service_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "services_project_id_slug_index" ON "services" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "users_login_index" ON "users" USING btree ("login");--> statement-breakpoint
CREATE UNIQUE INDEX "variables_service_id_key_index" ON "variables" USING btree ("service_id","key");