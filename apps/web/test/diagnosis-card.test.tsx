import type { Deployment, Diagnosis } from "@lift/shared";
import * as fixtures from "@lift/shared/fixtures";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { awaitingDiagnosis, DiagnosisCard } from "@/components/diagnosis-card";

const projectId = fixtures.project.id;
const failed = fixtures.allDeployments.find(
  (deployment) => deployment.id === fixtures.diagnosis.deploymentId,
) as Deployment;

function renderCard(diagnosis: Diagnosis | null, waiting = false) {
  const onEvidence = vi.fn();
  render(
    <DiagnosisCard
      projectId={projectId}
      diagnosis={diagnosis}
      waiting={waiting}
      lines={fixtures.failedBuildLog}
      onEvidence={onEvidence}
    />,
  );
  return { onEvidence };
}

afterEach(() => cleanup());

describe("the diagnosis card", () => {
  it("says what went wrong, shows the evidence, and what Lift did with a link to the redeploy", () => {
    const { onEvidence } = renderCard(fixtures.diagnosis);
    expect(screen.getByText(fixtures.diagnosis.summary)).toBeTruthy();
    expect(screen.getByText("Node version")).toBeTruthy();
    expect(screen.getByText("Attempt 1 of 3: what Lift did")).toBeTruthy();
    expect(screen.getByText("Set RAILPACK_NODE_VERSION to 22")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the new deployment" }).getAttribute("href")).toBe(
      `/p/${projectId}/deployments/${fixtures.fixtureIds.deployments.webActive}`,
    );
    // Each evidence line shows its text from the log, and clicking it points the log there.
    const evidence = screen.getByRole("list", { name: "Evidence" });
    expect(evidence.textContent).toContain("You are using Node.js 18.20.4");
    fireEvent.click(screen.getByRole("button", { name: /line 88/ }));
    expect(onEvidence).toHaveBeenCalledWith(88);
  });

  it("lists suggestions it didn't apply", () => {
    renderCard({
      ...fixtures.diagnosis,
      status: "proposed",
      actions: [
        {
          id: fixtures.fixtureIds.agentActions.setNodeVersion,
          tool: "update_service_settings",
          summary: "Change the start command to node dist/server.js",
          status: "proposed",
          deploymentId: null,
        },
      ],
    });
    expect(screen.getByText("Suggestions Lift didn't apply")).toBeTruthy();
    expect(screen.getByText("Change the start command to node dist/server.js")).toBeTruthy();
    expect(screen.queryByText(/what Lift did/)).toBeNull();
  });

  it("says when it's over to the user", () => {
    renderCard({ ...fixtures.diagnosis, status: "needs_human", actions: [] });
    expect(screen.getByText(/Lift didn't change anything/)).toBeTruthy();
  });

  it("shows that Lift is looking while it waits, and nothing otherwise", () => {
    renderCard(null, true);
    expect(screen.getByText("Lift is looking at this failure…")).toBeTruthy();
    cleanup();
    const { container } = render(
      <DiagnosisCard
        projectId={projectId}
        diagnosis={null}
        waiting={false}
        lines={[]}
        onEvidence={() => {}}
      />,
    );
    expect(container.textContent).toBe("");
  });
});

describe("waiting for a diagnosis", () => {
  const finished = Date.parse(failed.finishedAt ?? "");

  it("only for the app's own recent failures, on a service with autofix on", () => {
    expect(awaitingDiagnosis(failed, true, finished + 30_000)).toBe(true);
    expect(awaitingDiagnosis(failed, true, finished + 4 * 60_000)).toBe(false);
    expect(awaitingDiagnosis(failed, false, finished + 30_000)).toBe(false);
    expect(awaitingDiagnosis({ ...failed, errorCode: "clone_failed" }, true, finished)).toBe(false);
    const active = fixtures.allDeployments.find((deployment) => deployment.status === "active");
    expect(active && awaitingDiagnosis(active, true, finished)).toBe(false);
  });
});
