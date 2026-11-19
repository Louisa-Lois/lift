import { describe, expect, it } from "vitest";
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
