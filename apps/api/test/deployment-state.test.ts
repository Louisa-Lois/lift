import { DEPLOYMENT_STATUSES } from "@lift/shared";
import { describe, expect, it } from "vitest";
import { canTransition, isFinished } from "../src/services/deployment-state";

// docs/prd/01-backend-api.md, "Deployments": every edge of the table, and nothing else.
const PRD_EDGES = new Set([
  "queued→building",
  "building→deploying",
  "deploying→active",
  "active→superseded",
  "queued→failed",
  "building→failed",
  "deploying→failed",
  "queued→canceled",
  "building→canceled",
]);

const pairs = DEPLOYMENT_STATUSES.flatMap((from) =>
  DEPLOYMENT_STATUSES.map((to) => [from, to] as const),
);

describe("the deployment state machine", () => {
  it.each(pairs)("%s → %s follows the PRD", (from, to) => {
    expect(canTransition(from, to)).toBe(PRD_EDGES.has(`${from}→${to}`));
  });

  it("calls a deployment finished once nothing more will run for it", () => {
    expect(DEPLOYMENT_STATUSES.filter(isFinished)).toEqual([
      "active",
      "failed",
      "canceled",
      "superseded",
    ]);
  });
});
