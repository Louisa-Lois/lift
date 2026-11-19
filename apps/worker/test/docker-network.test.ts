import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDocker } from "../src/docker";

// Opt-in (LIFT_DOCKER_TESTS=1, with `pnpm stack:up` running): how the real Docker Engine answers
// attaching lift-pg to a project's network and detaching it again. lift-probe stands in for it.
const enabled = process.env.LIFT_DOCKER_TESTS === "1";
const docker = createDocker();
const network = `lift-prj-test${randomBytes(6).toString("hex")}`;

afterAll(async () => {
  if (!enabled) return;
  await docker.disconnectNetwork(network, "lift-probe").catch(() => undefined);
  await docker.removeNetwork(network).catch(() => undefined);
});

describe.skipIf(!enabled)("a project's network", () => {
  it("takes a container once however often it's attached, and lets it go the same way", async () => {
    await docker.createNetwork(network, { "lift.project": "test" });
    await docker.connectNetwork(network, "lift-probe");
    await docker.connectNetwork(network, "lift-probe");
    const attached = await docker.inspectContainer("lift-probe");
    expect(Object.keys(attached?.NetworkSettings?.Networks ?? {})).toContain(network);

    await docker.disconnectNetwork(network, "lift-probe");
    // Engine 29 answers these with 500 "not connected"; both must count as done.
    await docker.disconnectNetwork(network, "lift-probe");
    await docker.removeNetwork(network);
    await docker.disconnectNetwork(network, "lift-probe");
    expect(await docker.networkExists(network)).toBe(false);
  });
});
