import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  DATABASE_STATUSES,
  DEPLOYMENT_STATUSES,
  DEPLOYMENT_TRIGGERS,
  newId,
  VARIABLE_SOURCES,
} from "@lift/shared";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs every migration against a throwaway database on the Postgres from `pnpm stack:up`, then
// drops it. Fails (never skips) when Postgres isn't reachable, so a missing stack can't hide a
// broken migration.
const serverUrl = process.env.DATABASE_URL ?? "postgres://lift:lift@localhost:5432/lift";
const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
const testDatabase = `lift_migrate_test_${randomBytes(4).toString("hex")}`;

let admin: postgres.Sql;
let sql: postgres.Sql;

beforeAll(async () => {
  admin = postgres(serverUrl, { max: 1, onnotice: () => {} });
  try {
    await admin`select 1`;
  } catch (error) {
    throw new Error(
      `Postgres isn't reachable at ${new URL(serverUrl).host}. Start it with \`pnpm stack:up\`.`,
      { cause: error },
    );
  }
  await admin.unsafe(`create database ${testDatabase}`);
  const url = new URL(serverUrl);
  url.pathname = `/${testDatabase}`;
  sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder });
}, 60_000);

afterAll(async () => {
  await sql?.end();
  await admin?.unsafe(`drop database if exists ${testDatabase} with (force)`);
  await admin?.end();
});

const V1_TABLES = [
  "users",
  "sessions",
  "api_tokens",
  "cli_logins",
  "projects",
  "project_members",
  "services",
  "deployments",
  "deployment_events",
  "build_logs",
  "variables",
  "databases",
  "domains",
  "events",
  "metric_samples",
  "onboarding_plans",
  "agent_sessions",
  "agent_messages",
  "agent_actions",
  "diagnoses",
  "editor_documents",
  "editor_commits",
  "eval_runs",
  "eval_results",
];

async function enumValues(name: string) {
  const rows = await sql<{ value: string }[]>`
    select e.enumlabel as value from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = ${name} order by e.enumsortorder`;
  return rows.map((r) => r.value);
}

async function indexDefinition(name: string) {
  const [row] = await sql<{ indexdef: string }[]>`
    select indexdef from pg_indexes where schemaname = 'public' and indexname = ${name}`;
  return row?.indexdef;
}

describe("the first migration", () => {
  it("creates every v1 table", async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables where table_schema = 'public'`;
    expect(rows.map((r) => r.table_name).sort()).toEqual([...V1_TABLES].sort());
  });

  it("builds the Postgres enums from the shared enum values", async () => {
    expect(await enumValues("deployment_status")).toEqual([...DEPLOYMENT_STATUSES]);
    expect(await enumValues("deployment_trigger")).toEqual([...DEPLOYMENT_TRIGGERS]);
    expect(await enumValues("variable_source")).toEqual([...VARIABLE_SOURCES]);
    expect(await enumValues("database_status")).toEqual([...DATABASE_STATUSES]);
  });

  it("creates the indexes from the PRD and the ones agreed in BE-00", async () => {
    expect(await indexDefinition("deployments_service_id_queued_at_index")).toMatch(
      /\(service_id, queued_at DESC\)/,
    );
    expect(await indexDefinition("events_project_id_created_at_index")).toMatch(
      /\(project_id, created_at DESC\)/,
    );
    expect(await indexDefinition("deployments_push_editor_dedup")).toMatch(
      /UNIQUE INDEX .*\(service_id, commit_sha\) WHERE .*push.*editor/,
    );
    expect(await indexDefinition("deployments_one_active_per_service")).toMatch(
      /UNIQUE INDEX .*\(service_id\) WHERE .*active/,
    );
    for (const name of [
      "services_project_id_slug_index",
      "variables_service_id_key_index",
      "editor_documents_service_id_path_index",
      "metric_samples_service_id_ts_index",
    ]) {
      expect(await indexDefinition(name), name).toBeDefined();
    }
  });

  it("applies cleanly a second time (nothing left to run)", async () => {
    await expect(migrate(drizzle(sql), { migrationsFolder })).resolves.toBeUndefined();
  });
});

describe("deployment de-duplication", () => {
  const userId = newId("usr");
  const projectId = newId("prj");
  const serviceId = newId("svc");
  const commit = "3f9c2a1b7d4e5f60718293a4b5c6d7e8f9012345";

  async function insertDeployment(trigger: string, status = "queued", commitSha = commit) {
    const id = newId("dep");
    await sql`
      insert into deployments (id, service_id, project_id, status, trigger, commit_sha)
      values (${id}, ${serviceId}, ${projectId}, ${status}, ${trigger}, ${commitSha})`;
    return id;
  }

  const UNIQUE_VIOLATION = { code: "23505" };

  beforeAll(async () => {
    await sql`
      insert into users (id, github_id, login, avatar_url, github_token_enc)
      values (${userId}, 4242, 'ama-owusu', 'https://github.com/identicons/ama-owusu.png', '\\x00')`;
    await sql`insert into projects (id, name, slug, owner_id) values (${projectId}, 'Demo shop', 'demo-shop', ${userId})`;
    await sql`
      insert into services (id, project_id, name, slug, type, repo_owner, repo_name, branch, root_dir, builder, subdomain)
      values (${serviceId}, ${projectId}, 'web', 'web', 'web', 'lift-demo', 'next-hello', 'main', '.', 'railpack', 'web-demo-shop')`;
  });

  it("allows one push deployment per commit and skips a repeat delivery", async () => {
    await insertDeployment("push");
    await expect(insertDeployment("push")).rejects.toMatchObject(UNIQUE_VIOLATION);
  });

  it("treats an editor commit and its webhook as the same deployment", async () => {
    const editorCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    await insertDeployment("editor", "queued", editorCommit);
    await expect(insertDeployment("push", "queued", editorCommit)).rejects.toMatchObject(
      UNIQUE_VIOLATION,
    );
  });

  it("still lets people redeploy or roll back the same commit", async () => {
    await expect(insertDeployment("manual")).resolves.toMatch(/^dep_/);
    await expect(insertDeployment("cli")).resolves.toMatch(/^dep_/);
    await expect(insertDeployment("rollback", "deploying")).resolves.toMatch(/^dep_/);
  });

  it("keeps at most one active deployment per service", async () => {
    await insertDeployment("manual", "active");
    await expect(insertDeployment("manual", "active")).rejects.toMatchObject(UNIQUE_VIOLATION);
  });
});
