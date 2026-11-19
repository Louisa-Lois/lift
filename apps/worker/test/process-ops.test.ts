import type { DatabaseStatusReport, ProvisionContext } from "@lift/shared";
import type { Sql } from "postgres";
import { describe, expect, it } from "vitest";
import { type InternalApi, StopDeployment } from "../src/internal-api";
import { createLogger } from "../src/logger";
import { processOp } from "../src/ops/process-ops";
import { fakeDocker } from "./helpers/fake-docker";

const log = createLogger("silent");
const SERVICE = "svc_bbbbbbbbbbbbbbbbbbbbbbbb";
const PROJECT = "prj_cccccccccccccccccccccccc";

describe("ops jobs", () => {
  it("remove_service removes every container of the service, and only those", async () => {
    const { docker, calls } = fakeDocker({
      existing: [
        { id: "a", name: "lift-web-111111", labels: { "lift.service": SERVICE } },
        { id: "b", name: "lift-web-222222", labels: { "lift.service": SERVICE } },
        {
          id: "c",
          name: "lift-api-333333",
          labels: { "lift.service": "svc_other000000000000000000" },
        },
      ],
    });
    await processOp(
      { op: "remove_service", serviceId: SERVICE, projectId: PROJECT },
      { docker, log },
    );
    expect(calls).toEqual(["remove:a", "remove:b"]);
  });

  it("refuses the ops that arrive with INF-10, so BullMQ keeps them", async () => {
    const { docker } = fakeDocker();
    await expect(
      processOp(
        {
          op: "restart",
          deploymentId: "dep_aaaaaaaaaaaaaaaaaaaaaaaa",
          serviceId: SERVICE,
          projectId: PROJECT,
        },
        { docker, log },
      ),
    ).rejects.toThrow(/INF-10/);
  });
});

const DATABASE = "db_dddddddddddddddddddddddd";
const PASSWORD = "pw-only-the-worker-knows-1";
const context: ProvisionContext = {
  databaseId: DATABASE,
  projectId: PROJECT,
  type: "postgres",
  dbName: DATABASE,
  username: DATABASE,
  password: PASSWORD,
};
const pg = {} as Sql;

/** The internal API's database routes, recording each report. */
function fakeApi(options: { contextError?: Error } = {}) {
  const reports: DatabaseStatusReport[] = [];
  const api = {
    async provisionContext() {
      if (options.contextError) throw options.contextError;
      return context;
    },
    async reportDatabase(_id: string, report: DatabaseStatusReport) {
      reports.push(report);
      return { status: report.status };
    },
  } as unknown as InternalApi;
  return { api, reports };
}

describe("database ops", () => {
  const provisionJob = {
    op: "provision_db" as const,
    databaseId: DATABASE,
    projectId: PROJECT,
    type: "postgres" as const,
  };

  it("provision_db creates the database, puts lift-pg on the project's network and reports ready", async () => {
    const { docker, calls } = fakeDocker();
    const { api, reports } = fakeApi();
    const created: unknown[] = [];
    const outcome = await processOp(provisionJob, {
      docker,
      log,
      api,
      pg,
      provision: async (sql, given) => {
        created.push([sql, given]);
      },
    });
    expect(outcome).toBe("ready");
    expect(created).toEqual([[pg, context]]);
    expect(calls).toEqual([
      `network:lift-prj-${PROJECT}:{"lift.project":"${PROJECT}"}`,
      `connect:lift-pg:lift-prj-${PROJECT}`,
    ]);
    expect(reports).toEqual([{ status: "ready", host: "lift-pg", port: 5432 }]);
  });

  it("provision_db reports a failure in Postgres's words, never the password", async () => {
    const { docker } = fakeDocker();
    const { api, reports } = fakeApi();
    await expect(
      processOp(provisionJob, {
        docker,
        log,
        api,
        pg,
        provision: async () => {
          throw new Error('role "db_x" cannot be created: too many connections');
        },
      }),
    ).rejects.toThrow(/too many connections/);
    expect(reports).toEqual([
      {
        status: "failed",
        message:
          'Lift couldn\'t create the database: role "db_x" cannot be created: too many connections',
      },
    ]);
    expect(JSON.stringify(reports)).not.toContain(PASSWORD);
  });

  it("provision_db stops quietly when the database was deleted meanwhile", async () => {
    const { docker, calls } = fakeDocker();
    const { api, reports } = fakeApi({ contextError: new StopDeployment("deleted") });
    expect(await processOp(provisionJob, { docker, log, api, pg })).toBe("stopped");
    expect([calls, reports]).toEqual([[], []]);
  });

  it("provision_db refuses Redis, and a worker without LIFT_PG_URL, with a failure report", async () => {
    const { docker } = fakeDocker();
    const redis = fakeApi();
    expect(
      await processOp({ ...provisionJob, type: "redis" }, { docker, log, api: redis.api, pg }),
    ).toBe("refused");
    expect(redis.reports[0]).toMatchObject({ status: "failed" });

    const noPg = fakeApi();
    await expect(processOp(provisionJob, { docker, log, api: noPg.api, pg: null })).rejects.toThrow(
      /LIFT_PG_URL/,
    );
    expect(noPg.reports[0]?.status).toBe("failed");
  });

  it("deprovision_db drops the database and takes lift-pg off the project's network", async () => {
    const { docker, calls } = fakeDocker();
    const { api, reports } = fakeApi();
    const dropped: string[] = [];
    const outcome = await processOp(
      { ...provisionJob, op: "deprovision_db" },
      {
        docker,
        log,
        api,
        pg,
        deprovision: async (_sql, name) => {
          dropped.push(name);
        },
      },
    );
    expect(outcome).toBe("dropped");
    expect(dropped).toEqual([DATABASE]);
    expect(calls).toEqual([`disconnect:lift-pg:lift-prj-${PROJECT}`]);
    expect(reports).toEqual([]);
  });
});
