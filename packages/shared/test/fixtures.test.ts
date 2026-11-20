import { describe, expect, it } from "vitest";
import { z } from "zod";
import packageJson from "../package.json";
import {
  ApiToken,
  CreatedApiToken,
  Database,
  DatabaseCredentials,
  DEPLOYMENT_STATUSES,
  DEPLOYMENT_TRIGGERS,
  Deployment,
  DeploymentDetail,
  Diagnosis,
  Domain,
  EditorChange,
  EditorSession,
  EditorTree,
  GithubBranch,
  GithubRepo,
  LogEntry,
  maskVariableValue,
  OnboardingPlan,
  ProjectDetail,
  ProjectEvent,
  ProjectListItem,
  ProjectMember,
  RuntimeEnv,
  Service,
  User,
  VARIABLE_SOURCES,
  Variable,
} from "../src";
import * as fixtures from "../src/fixtures";

const parsesWith: Record<string, [z.ZodType, unknown]> = {
  me: [User, fixtures.me],
  users: [z.array(User), Object.values(fixtures.users)],
  members: [z.array(ProjectMember), fixtures.members],
  project: [ProjectDetail, fixtures.project],
  projectListItem: [ProjectListItem, fixtures.projectListItem],
  services: [z.array(Service), Object.values(fixtures.services)],
  database: [Database, fixtures.database],
  databaseCredentials: [DatabaseCredentials, fixtures.databaseCredentials],
  domains: [z.array(Domain), fixtures.domains],
  variables: [z.array(Variable), Object.values(fixtures.variables).flat()],
  revealedVariables: [z.array(Variable), Object.values(fixtures.revealedVariables).flat()],
  runtimeEnv: [RuntimeEnv, fixtures.runtimeEnv],
  deployments: [z.array(Deployment), Object.values(fixtures.deployments).flat()],
  allDeployments: [z.array(Deployment), fixtures.allDeployments],
  deploymentDetails: [z.array(DeploymentDetail), Object.values(fixtures.deploymentDetails)],
  events: [z.array(ProjectEvent), fixtures.events],
  buildLog: [z.array(LogEntry), fixtures.buildLog],
  failedBuildLog: [z.array(LogEntry), fixtures.failedBuildLog],
  deploymentLogs: [z.array(LogEntry), Object.values(fixtures.deploymentLogs).flat()],
  githubRepos: [z.array(GithubRepo), fixtures.githubRepos],
  githubBranches: [z.array(GithubBranch), Object.values(fixtures.githubBranches).flat()],
  apiTokens: [z.array(ApiToken), fixtures.apiTokens],
  createdApiToken: [CreatedApiToken, fixtures.createdApiToken],
  onboardingPlan: [OnboardingPlan, fixtures.onboardingPlan],
  diagnosis: [Diagnosis, fixtures.diagnosis],
  editorTree: [EditorTree, fixtures.editorTree],
  editorSession: [EditorSession, fixtures.editorSession],
  editorChanges: [z.array(EditorChange), fixtures.editorChanges],
};

describe("every fixture", () => {
  it.each(Object.entries(parsesWith))("%s parses with its schema", (_name, [schema, value]) => {
    const result = schema.safeParse(value);
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it("is covered by the table above, so a new fixture can't skip validation", () => {
    const helpers = ["fixtureIds", "page"];
    expect(Object.keys(fixtures).sort()).toEqual([...Object.keys(parsesWith), ...helpers].sort());
  });

  it("is published as @lift/shared/fixtures", () => {
    expect(packageJson.exports["./fixtures"]).toBe("./src/fixtures/index.ts");
  });
});

describe("the token fixtures", () => {
  it("carry a plaintext token only in the answer to POST /tokens", () => {
    const { token } = fixtures.createdApiToken;
    expect(JSON.stringify(fixtures.apiTokens)).not.toContain(token);
    for (const listed of fixtures.apiTokens) expect(listed).not.toHaveProperty("token");
    expect(fixtures.createdApiToken.prefix).toBe(token.slice(0, 12));
  });
});

describe("the demo project", () => {
  const all = fixtures.allDeployments;
  const services = Object.values(fixtures.services);

  it("has deployments in every status and from every trigger", () => {
    expect(new Set(all.map((d) => d.status))).toEqual(new Set(DEPLOYMENT_STATUSES));
    expect(new Set(all.map((d) => d.trigger))).toEqual(new Set(DEPLOYMENT_TRIGGERS));
  });

  it("has exactly one active deployment per service, matching the service", () => {
    for (const service of services) {
      const active = all.filter((d) => d.serviceId === service.id && d.status === "active");
      expect(active).toHaveLength(1);
      expect(service.activeDeploymentId).toBe(active[0]?.id);
    }
  });

  it("lists each service's deployments newest first, latest one matching the service", () => {
    for (const [key, list] of Object.entries(fixtures.deployments)) {
      const service = fixtures.services[key as keyof typeof fixtures.services];
      const times = list.map((d) => d.queuedAt);
      expect(times).toEqual([...times].sort().reverse());
      expect(list.every((d) => d.serviceId === service.id)).toBe(true);
      expect(service.latestDeployment?.id).toBe(list[0]?.id);
      expect(service.latestDeployment?.status).toBe(list[0]?.status);
    }
  });

  it("ends every deployment's timeline in its current status", () => {
    for (const deployment of all) {
      const detail = fixtures.deploymentDetails[deployment.id];
      expect(detail).toMatchObject(deployment);
      expect(detail?.timeline.at(-1)?.status).toBe(deployment.status);
    }
  });

  it("fills in the fields each status implies", () => {
    for (const d of all) {
      if (d.status === "failed") expect(d.errorCode).not.toBeNull();
      else expect(d.errorCode).toBeNull();
      if (["active", "superseded", "deploying"].includes(d.status))
        expect(d.imageTag).not.toBeNull();
      if (["active", "superseded"].includes(d.status)) expect(d.containerId).not.toBeNull();
      if (d.status === "queued") expect(d.startedAt).toBeNull();
    }
  });

  it("rolls back by reusing an earlier deployment's image", () => {
    const rollback = all.find((d) => d.trigger === "rollback");
    const target = all.find((d) => d.id === rollback?.rollbackOf);
    expect(target).toBeDefined();
    expect(rollback?.imageTag).toBe(target?.imageTag);
  });

  it("keeps every resource inside the one project", () => {
    const projectId = fixtures.project.id;
    expect(all.every((d) => d.projectId === projectId)).toBe(true);
    expect(services.every((s) => s.projectId === projectId)).toBe(true);
    expect(fixtures.events.every((e) => e.projectId === projectId)).toBe(true);
    expect(fixtures.project.services.map((s) => s.id).sort()).toEqual(
      services.map((s) => s.id).sort(),
    );
    expect(fixtures.project.databases).toEqual([fixtures.database]);
  });

  it("has variables from every source; system ones appear only in the runtime env", () => {
    const stored = Object.values(fixtures.variables).flat();
    const sources = new Set([
      ...stored.map((v) => v.source),
      ...fixtures.runtimeEnv.variables.map((v) => v.source),
    ]);
    expect(sources).toEqual(new Set(VARIABLE_SOURCES));
    expect(stored.some((v) => (v.source as string) === "system")).toBe(false);
  });

  it("masks stored values the way the API does, unless revealed", () => {
    for (const key of ["web", "api"] as const) {
      const revealed = fixtures.revealedVariables[key];
      expect(fixtures.variables[key]).toEqual(
        revealed.map((v) => ({ ...v, value: maskVariableValue(v.value) })),
      );
    }
  });

  it("links DATABASE_URL to the Postgres database it came from", () => {
    const databaseUrl = fixtures.variables.api.find((v) => v.key === fixtures.database.envVar);
    expect(databaseUrl).toMatchObject({ source: "database", databaseId: fixtures.database.id });
  });

  it("lists events newest first", () => {
    const times = fixtures.events.map((e) => e.createdAt);
    expect(times).toEqual([...times].sort().reverse());
    expect(new Set(fixtures.events.map((e) => e.id)).size).toBe(fixtures.events.length);
  });
});

describe("the build logs", () => {
  const order = (id: string) => id.split("-").map(Number) as [number, number];
  const ascending = (log: LogEntry[]) =>
    log.every((entry, i) => {
      const previous = log[i - 1];
      if (!previous) return true;
      const [ms, seq] = order(entry.id);
      const [prevMs, prevSeq] = order(previous.id);
      return ms > prevMs || (ms === prevMs && seq > prevSeq);
    });

  it("include a successful build of about 200 lines", () => {
    expect(fixtures.buildLog.length).toBeGreaterThanOrEqual(180);
    expect(fixtures.buildLog.length).toBeLessThanOrEqual(230);
    expect(new Set(fixtures.buildLog.map((l) => l.stream))).toEqual(
      new Set(["system", "build", "deploy"]),
    );
  });

  it("keep stream entry IDs strictly increasing and timestamps in order", () => {
    for (const log of [fixtures.buildLog, fixtures.failedBuildLog]) {
      expect(ascending(log)).toBe(true);
      const times = log.map((l) => l.ts);
      expect(times).toEqual([...times].sort());
    }
  });

  it("belong to the deployments they describe", () => {
    const active = fixtures.services.web.activeDeploymentId;
    const failed = fixtures.deployments.web.find((d) => d.status === "failed");
    expect(active && fixtures.deploymentLogs[active]).toEqual(fixtures.buildLog);
    expect(failed && fixtures.deploymentLogs[failed.id]).toEqual(fixtures.failedBuildLog);
  });
});
