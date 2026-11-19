import { describe, expect, it } from "vitest";
import { type DeploymentImage, keptImageTags, rollbackTarget } from "../src";

let clock = 0;
/** A deployment, each newer than the last one made. */
function deployment(
  status: DeploymentImage["status"],
  imageTag: string | null,
  id = `dep_${String(++clock).padStart(24, "0")}`,
): DeploymentImage {
  return {
    id,
    status,
    imageTag,
    createdAt: new Date(Date.UTC(2026, 10, 19, 0, clock)).toISOString(),
  };
}

describe("keptImageTags", () => {
  it("keeps the 3 newest distinct images, and the active one however old", () => {
    clock = 0;
    const active = deployment("active", "img-1");
    const list = [
      active,
      deployment("failed", "img-2"),
      deployment("failed", null), // a failed build has no image
      deployment("failed", "img-3"),
      deployment("canceled", null),
      deployment("failed", "img-4"),
      deployment("failed", "img-5"),
    ];
    expect([...keptImageTags(list)].sort()).toEqual(["img-1", "img-3", "img-4", "img-5"]);
  });

  it("counts a rolled-back image once", () => {
    clock = 0;
    const list = [
      deployment("superseded", "img-1"),
      deployment("superseded", "img-2"),
      deployment("superseded", "img-3"),
      deployment("superseded", "img-4"),
      deployment("active", "img-2"), // a rollback to img-2
    ];
    expect([...keptImageTags(list)].sort()).toEqual(["img-2", "img-3", "img-4"]);
  });
});

describe("rollbackTarget", () => {
  clock = 0;
  const oldest = deployment("superseded", "img-1");
  const older = deployment("superseded", "img-2");
  const failed = deployment("failed", "img-3");
  const previous = deployment("superseded", "img-4");
  const active = deployment("active", "img-5");
  const all = [oldest, older, failed, previous, active];

  it("offers a superseded deployment whose image Lift keeps", () => {
    expect(rollbackTarget(previous, all)).toEqual({ ok: true });
  });

  it("refuses the live one, one that never was live, and one whose image is gone", () => {
    expect(rollbackTarget(active, all)).toEqual({
      ok: false,
      reason: "This deployment is live now.",
    });
    expect(rollbackTarget(failed, all).ok).toBe(false);
    expect(rollbackTarget(older, all)).toEqual({
      ok: false,
      reason: "Lift keeps the images of a service's last 3 builds; this one's is gone.",
    });
    expect(rollbackTarget(oldest, all).ok).toBe(false);
  });

  it("refuses a deployment whose image is the one running now", () => {
    clock = 100;
    const first = deployment("superseded", "img-a");
    const rolledBack = deployment("active", "img-a");
    expect(rollbackTarget(first, [first, rolledBack])).toEqual({
      ok: false,
      reason: "Its image is the one running now.",
    });
  });
});
