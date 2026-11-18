import { describe, expect, it } from "vitest";
import { newId } from "../src/ids";
import {
  AutofixJob,
  BuildJob,
  DeployJob,
  JOB_NAMES,
  OPS,
  OpsJob,
  postgresNamesFor,
  QUEUE_NAMES,
} from "../src/jobs";

const deploymentId = newId("dep");
const serviceId = newId("svc");
const projectId = newId("prj");
const databaseId = newId("db");

const build = {
  deploymentId,
  serviceId,
  projectId,
  repo: { owner: "lift-demo", name: "next-hello", branch: "main" },
  commitSha: "3f9c2a1b7d4e5f60718293a4b5c6d7e8f9012345",
  rootDir: ".",
  builder: "railpack",
} as const;

const deploy = {
  deploymentId,
  serviceId,
  serviceSlug: "web",
  projectId,
  imageTag: `lift/${serviceId}:${deploymentId}`,
  port: 3000,
  healthcheckPath: "/",
  cpu: 0.5,
  memoryMb: 512,
  hostnames: ["web-demo-shop.apps.localhost"],
};

describe("queues", () => {
  it("are the names in docs/contracts.md, plus lift-agent for autofix", () => {
    expect(QUEUE_NAMES).toEqual({
      build: "lift-build",
      deploy: "lift-deploy",
      ops: "lift-ops",
      agent: "lift-agent",
    });
    expect(JOB_NAMES).toEqual({ build: "build", deploy: "deploy", autofix: "autofix" });
    expect(OPS).toEqual(["stop", "restart", "remove_service", "provision_db", "deprovision_db"]);
  });
});

describe("build job", () => {
  it("accepts the documented payload", () => {
    expect(BuildJob.parse(build)).toEqual(build);
    const dockerfileBuild = { ...build, builder: "dockerfile", dockerfilePath: "Dockerfile" };
    expect(BuildJob.parse(dockerfileBuild)).toEqual(dockerfileBuild);
  });

  it.each(["token", "cloneToken", "password", "env", "variables"])(
    "rejects an extra %s field, so a secret can't ride along",
    (key) => {
      expect(BuildJob.safeParse({ ...build, [key]: "x" }).success).toBe(false);
      expect(BuildJob.safeParse({ ...build, repo: { ...build.repo, [key]: "x" } }).success).toBe(
        false,
      );
    },
  );
});

describe("deploy job", () => {
  it("accepts the documented payload with the service slug", () => {
    expect(DeployJob.parse(deploy)).toEqual(deploy);
  });

  it("needs the service slug, which names the container and its network alias", () => {
    const { serviceSlug: _omitted, ...withoutSlug } = deploy;
    expect(DeployJob.safeParse(withoutSlug).success).toBe(false);
  });

  it("needs at least one hostname and no extra fields", () => {
    expect(DeployJob.safeParse({ ...deploy, hostnames: [] }).success).toBe(false);
    expect(DeployJob.safeParse({ ...deploy, env: { SECRET: "x" } }).success).toBe(false);
  });
});

describe("ops jobs", () => {
  it.each([
    { op: "stop", deploymentId, serviceId, projectId },
    { op: "restart", deploymentId, serviceId, projectId },
    { op: "remove_service", serviceId, projectId },
    { op: "provision_db", databaseId, projectId, type: "postgres" },
    { op: "deprovision_db", databaseId, projectId, type: "redis" },
  ])("$op carries only the IDs it acts on", (job) => {
    expect(OpsJob.parse(job)).toEqual(job);
    expect(OpsJob.safeParse({ ...job, password: "x" }).success).toBe(false);
  });

  it("rejects an unknown op or a missing ID", () => {
    expect(OpsJob.safeParse({ op: "reboot", serviceId, projectId }).success).toBe(false);
    expect(OpsJob.safeParse({ op: "stop", serviceId, projectId }).success).toBe(false);
  });
});

describe("autofix job", () => {
  it("carries only the failed deployment's ID", () => {
    expect(AutofixJob.parse({ deploymentId })).toEqual({ deploymentId });
    expect(AutofixJob.safeParse({ deploymentId, logs: "…" }).success).toBe(false);
  });
});

describe("database names", () => {
  it("name the Postgres database and role after the database ID", () => {
    expect(postgresNamesFor(databaseId)).toEqual({ database: databaseId, role: databaseId });
    expect(databaseId).toMatch(/^[a-z_][a-z0-9_]{0,62}$/);
  });
});
