import type { CursorPage, Deployment, DeploymentDetail, ProjectEvent } from "@lift/shared";
import * as fixtures from "@lift/shared/fixtures";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { applyProjectEvent } from "@/lib/hooks/use-project-events";
import { queryKeys } from "@/lib/query-keys";

const [newest, older] = fixtures.deployments.web as [Deployment, Deployment];
const event = (fields: Pick<ProjectEvent, "type" | "data">): ProjectEvent =>
  ({
    id: "evt_aaaaaaaaaaaaaaaaaaaaaaaa",
    projectId: newest.projectId,
    actorType: "worker",
    actorId: null,
    createdAt: "2026-11-21T09:00:00.000Z",
    ...fields,
  }) as ProjectEvent;

function cache() {
  const queryClient = new QueryClient();
  const detail = fixtures.deploymentDetails[older.id] as DeploymentDetail;
  queryClient.setQueryData(queryKeys.deployment(older.id), detail);
  queryClient.setQueryData(queryKeys.deployments(older.serviceId), fixtures.page([older]));
  return { queryClient, detail };
}

describe("project events in the cache", () => {
  it("move a deployment's status in its page and in its service's list", () => {
    const { queryClient, detail } = cache();
    applyProjectEvent(
      queryClient,
      event({
        type: "deployment.status_changed",
        data: { ...older, status: "superseded", previousStatus: older.status },
      }),
    );
    expect(queryClient.getQueryData(queryKeys.deployment(older.id))).toMatchObject({
      status: "superseded",
      timeline: detail.timeline,
    });
    const list = queryClient.getQueryData<CursorPage<Deployment>>(
      queryKeys.deployments(older.serviceId),
    );
    expect(list?.data[0]?.status).toBe("superseded");
    expect(list?.data[0]).not.toHaveProperty("previousStatus");
  });

  it("put a new deployment at the top of its service's list", () => {
    const { queryClient } = cache();
    applyProjectEvent(queryClient, event({ type: "deployment.created", data: newest }));
    const list = queryClient.getQueryData<CursorPage<Deployment>>(
      queryKeys.deployments(newest.serviceId),
    );
    expect(list?.data.map((deployment) => deployment.id)).toEqual([newest.id, older.id]);
  });

  it("put a new diagnosis on its failed deployment's page at once", () => {
    const { queryClient } = cache();
    applyProjectEvent(queryClient, event({ type: "diagnosis.created", data: fixtures.diagnosis }));
    expect(queryClient.getQueryData(queryKeys.diagnosis(fixtures.diagnosis.deploymentId))).toEqual(
      fixtures.diagnosis,
    );
  });
});
