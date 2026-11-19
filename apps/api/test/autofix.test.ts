import { randomBytes } from "node:crypto";
import { schema } from "@lift/db";
import { createTestDatabase, type TestDatabase } from "@lift/db/testing";
import {
  API_BASE_PATH,
  AutofixContext,
  type CreateDiagnosisBody,
  Deployment,
  DeploymentDetail,
  Diagnosis,
  INTERNAL_BASE_PATH,
  INTERNAL_ROUTES,
  Problem,
  ProjectDetail,
  REDIS_STREAMS,
  Service,
  User,
} from "@lift/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSecretBox } from "../src/services/crypto";
import { buildTestApp, TEST_AGENT_TOKEN, TEST_ENCRYPTION_KEY } from "./helpers/app";
import { fakeGithub } from "./helpers/github";
import { as, signIn } from "./helpers/session";

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const WORKER_TOKEN = `test-worker-${randomBytes(16).toString("hex")}`;
const queuePrefix = `test-${randomBytes(4).toString("hex")}`;
const secretBox = createSecretBox(TEST_ENCRYPTION_KEY);
const github = fakeGithub();

let database: TestDatabase;
let app: TestApp;
let session: string;
let ownerId: string;
let projectId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  app = await buildTestApp(database, { WORKER_TOKEN }, { githubFetch: github.fetch, queuePrefix });
  session = await signIn(app);
  ownerId = User.parse((await call("GET", "/me")).json()).id;
  projectId = ProjectDetail.parse((await call("POST", "/projects", { name: "Autofix" })).json()).id;
}, 60_000);

afterAll(async () => {
  if (app) {
    for (const queue of Object.values(app.queues)) await queue.obliterate({ force: true });
    await app.redis.del(REDIS_STREAMS.projectEvents.key(projectId));
    await app.close();
  }
  await database?.drop();
});

function call(method: "GET" | "POST" | "PATCH", url: string, payload?: object) {
  return app.inject({
    method,
    url: `${API_BASE_PATH}${url}`,
    ...as(session),
    ...(payload ? { payload } : {}),
  });
}

const report = (deploymentId: string, body: object) =>
  app.inject({
    method: "POST",
    url: `${INTERNAL_BASE_PATH}${INTERNAL_ROUTES.deploymentStatus.path(deploymentId)}`,
    headers: { authorization: `Bearer ${WORKER_TOKEN}` },
    payload: { at: new Date().toISOString(), ...body },
  });

const agent = { authorization: `Bearer ${TEST_AGENT_TOKEN}` };
const context = (deploymentId: string, headers: Record<string, string> = agent) =>
  app.inject({
    method: "GET",
    url: `${INTERNAL_BASE_PATH}${INTERNAL_ROUTES.autofixContext.path(deploymentId)}`,
    headers,
  });
const diagnose = (body: Partial<CreateDiagnosisBody> & { deploymentId: string }) =>
  app.inject({
    method: "POST",
    url: `${INTERNAL_BASE_PATH}${INTERNAL_ROUTES.diagnoses.path()}`,
    headers: agent,
    payload: {
      category: "wrong_port",
      summary: "The app listens on 8080, not 3000.",
      evidence: [137],
      changes: [],
      proposals: [],
      ...body,
    },
  });

let count = 0;
async function newService(options: { autofix?: boolean } = {}): Promise<Service> {
  count += 1;
  const response = await call("POST", `/projects/${projectId}/services`, {
    name: `web${count}`,
    repo: { owner: "lift-demo", name: "next-hello" },
    branch: "main",
  });
  const service = Service.parse(response.json());
  if (options.autofix === false) await call("PATCH", `/services/${service.id}`, { autofix: false });
  return service;
}

/** A deployment that failed the way the worker reports it. */
async function failed(serviceId: string, errorCode = "healthcheck_failed"): Promise<Deployment> {
  const response = await call("POST", `/services/${serviceId}/deployments`, {});
  const deployment = Deployment.parse(response.json());
  await report(deployment.id, { status: "building" });
  await report(deployment.id, { status: "failed", errorCode, message: "Deploy failed" });
  return deployment;
}

const autofixJob = (deploymentId: string) => app.queues.agent.getJob(`autofix-${deploymentId}`);
const latest = async (serviceId: string) =>
  Service.parse((await call("GET", `/services/${serviceId}`)).json());

describe("queueing autofix", () => {
  it("queues the app's own failures once, on a service with autofix on", async () => {
    const service = await newService();
    for (const code of ["healthcheck_failed", "crashed", "build_failed"]) {
      const deployment = await failed(service.id, code);
      const job = await autofixJob(deployment.id);
      expect(job?.data, code).toEqual({ deploymentId: deployment.id });
    }
    const lifts = await failed(service.id, "clone_failed");
    expect(await autofixJob(lifts.id)).toBeUndefined();
    const off = await newService({ autofix: false });
    expect(await autofixJob((await failed(off.id)).id)).toBeUndefined();
  });
});

describe("the autofix context", () => {
  it("takes only the agent's token, and never through Traefik", async () => {
    const service = await newService();
    const deployment = await failed(service.id);
    expect(
      (await context(deployment.id, { authorization: `Bearer ${WORKER_TOKEN}` })).statusCode,
    ).toBe(401);
    expect(
      (await context(deployment.id, { ...agent, "x-forwarded-for": "203.0.113.7" })).statusCode,
    ).toBe(404);
  });

  it("names the owner to act as, the variables without values, and the chain", async () => {
    const service = await newService();
    await call("PUT" as "POST", `/services/${service.id}/variables`, {
      variables: { SECRET_THING: "s3cr3t-value" },
    });
    const deployment = await failed(service.id);
    const response = await context(deployment.id);
    expect(response.statusCode).toBe(200);
    const body = AutofixContext.parse(response.json());
    expect(body).toMatchObject({
      actAs: ownerId,
      chain: { attempt: 1, previousCategory: null },
      newest: true,
      deployment: { id: deployment.id, status: "failed" },
      service: { id: service.id, port: 3000 },
    });
    expect(JSON.stringify(body)).not.toContain("s3cr3t-value");
  });
});

describe("writing a diagnosis", () => {
  it("applies an allowed fix, redeploys the same commit as the agent, and links the chain", async () => {
    const service = await newService();
    const deployment = await failed(service.id);
    const response = await diagnose({
      deploymentId: deployment.id,
      changes: [{ kind: "setting", setting: "port", value: "8080" }],
    });
    expect(response.statusCode).toBe(201);
    const diagnosis = Diagnosis.parse(response.json());
    expect(diagnosis).toMatchObject({ status: "fixed", attempt: 1, category: "wrong_port" });
    expect(diagnosis.actions.map((action) => [action.tool, action.summary, action.status])).toEqual(
      [
        ["update_service_settings", "Set the port to 8080", "completed"],
        ["deploy", `Redeployed ${deployment.commitSha.slice(0, 7)}`, "completed"],
      ],
    );
    expect((await latest(service.id)).port).toBe(8080);

    const redeployId = diagnosis.actions[1]?.deploymentId ?? "";
    const redeploy = DeploymentDetail.parse(
      (await call("GET", `/deployments/${redeployId}`)).json(),
    );
    expect(redeploy).toMatchObject({
      trigger: "agent",
      commitSha: deployment.commitSha,
      createdByActionId: diagnosis.actions[1]?.id,
      status: "queued",
    });
    // The public route serves it, and a second one for the same failure is refused.
    expect(
      Diagnosis.parse((await call("GET", `/deployments/${deployment.id}/diagnosis`)).json()),
    ).toEqual(diagnosis);
    expect((await diagnose({ deploymentId: deployment.id })).statusCode).toBe(409);

    // The redeploy fails too: the context counts it as the chain's second attempt.
    await report(redeployId, { status: "building" });
    await report(redeployId, { status: "failed", errorCode: "crashed", message: "Crashed" });
    expect(AutofixContext.parse((await context(redeployId)).json()).chain).toEqual({
      attempt: 2,
      previousCategory: "wrong_port",
    });
  });

  it("sets a safe default from the repo's .env.example as the agent's, and refuses anything else", async () => {
    const service = await newService();
    const deployment = await failed(service.id, "crashed");
    for (const value of [
      { key: "GREETING", value: "hi" },
      { key: "API_KEY", value: "change-me" },
      { key: "ADMIN_MODE", value: "true" },
    ]) {
      const refused = await diagnose({
        deploymentId: deployment.id,
        category: "missing_env_var",
        changes: [{ kind: "variable", ...value }],
      });
      expect(refused.statusCode, value.key).toBe(400);
      expect(Problem.parse(refused.json()).detail).toContain("Autofix may not make these changes");
    }
    const response = await diagnose({
      deploymentId: deployment.id,
      category: "missing_env_var",
      changes: [{ kind: "variable", key: "GREETING", value: "hello" }],
    });
    expect(Diagnosis.parse(response.json()).actions[0]?.summary).toBe("Set GREETING to hello");
    const [stored] = await database.db
      .select()
      .from(schema.variables)
      .where(and(eq(schema.variables.serviceId, service.id), eq(schema.variables.key, "GREETING")));
    expect(stored?.source).toBe("agent");
    expect(secretBox.decrypt(stored?.valueEnc ?? Buffer.alloc(0))).toBe("hello");
    // The API read the example file itself, at the failed commit, with the owner's token.
    const read = github.calls.findLast((entry) =>
      entry.url.pathname.endsWith("/contents/.env.example"),
    );
    expect(read?.url.searchParams.get("ref")).toBe(deployment.commitSha);
    expect(read?.headers.get("authorization")).toBe(`Bearer ${github.token}`);
    // Actions name the variable, never its value.
    const actions = await database.db
      .select()
      .from(schema.agentActions)
      .where(eq(schema.agentActions.tool, "set_variables"));
    expect(JSON.stringify(actions.map((action) => action.args))).not.toContain("hello");
  });

  it("records proposals without applying them", async () => {
    const service = await newService();
    const deployment = await failed(service.id, "crashed");
    const diagnosis = Diagnosis.parse(
      (
        await diagnose({
          deploymentId: deployment.id,
          category: "wrong_start_command",
          proposals: [{ kind: "setting", setting: "startCommand", value: "node dist/server.js" }],
        })
      ).json(),
    );
    expect(diagnosis.status).toBe("proposed");
    expect(diagnosis.actions).toEqual([
      expect.objectContaining({
        tool: "update_service_settings",
        summary: "Change the start command to node dist/server.js",
        status: "proposed",
      }),
    ]);
    expect((await latest(service.id)).startCommand).toBeNull();
    const nothing = await diagnose({
      deploymentId: (await failed(service.id, "crashed")).id,
      category: "code_error",
    });
    expect(Diagnosis.parse(nothing.json()).status).toBe("needs_human");
  });

  it("turns changes into proposals once a newer deployment exists, or after three fixes", async () => {
    const service = await newService();
    const stale = await failed(service.id);
    await failed(service.id);
    const late = Diagnosis.parse(
      (
        await diagnose({
          deploymentId: stale.id,
          changes: [{ kind: "setting", setting: "port", value: "8080" }],
        })
      ).json(),
    );
    expect(late.status).toBe("proposed");
    expect((await latest(service.id)).port).toBe(3000);

    // Three fixes in a chain, then the fourth failure gets no change.
    let current = (await failed(service.id)).id;
    for (const port of ["4001", "4002", "4003"]) {
      const fixed = Diagnosis.parse(
        (
          await diagnose({
            deploymentId: current,
            changes: [{ kind: "setting", setting: "port", value: port }],
          })
        ).json(),
      );
      expect(fixed.status).toBe("fixed");
      current = fixed.actions.find((action) => action.tool === "deploy")?.deploymentId ?? "";
      await report(current, { status: "building" });
      await report(current, {
        status: "failed",
        errorCode: "healthcheck_failed",
        message: "No answer",
      });
    }
    expect(AutofixContext.parse((await context(current)).json()).chain.attempt).toBe(4);
    const fourth = Diagnosis.parse(
      (
        await diagnose({
          deploymentId: current,
          changes: [{ kind: "setting", setting: "port", value: "4004" }],
        })
      ).json(),
    );
    expect(fourth).toMatchObject({ status: "proposed", attempt: 4 });
    expect((await latest(service.id)).port).toBe(4003);
  });

  it("is a 404 on the public route until autofix writes one", async () => {
    const service = await newService();
    const deployment = await failed(service.id);
    expect((await call("GET", `/deployments/${deployment.id}/diagnosis`)).statusCode).toBe(404);
  });
});
