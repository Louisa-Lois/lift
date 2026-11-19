import type { DeployJob } from "@lift/shared";
import { describe, expect, it } from "vitest";
import { containerSpec } from "../src/deploy/container-spec";
import { containerName, deploymentLabels } from "../src/deploy/labels";
import { readProbe } from "../src/deploy/probe";

const job: DeployJob = {
  deploymentId: "dep_aaaaaaaaaaaaaaaaaa1b2c3d",
  serviceId: "svc_bbbbbbbbbbbbbbbbbbbbbbbb",
  serviceSlug: "web",
  projectId: "prj_cccccccccccccccccccccccc",
  imageTag: "lift/svc_bbbbbbbbbbbbbbbbbbbbbbbb:dep_aaaaaaaaaaaaaaaaaa1b2c3d",
  port: 3000,
  healthcheckPath: "/",
  cpu: 0.5,
  memoryMb: 512,
  hostnames: ["web-demo-shop.apps.trylift.dev"],
};
const router = "traefik.http.routers.dep-dep_aaaaaaaaaaaaaaaaaa1b2c3d";

describe("a deployment's Traefik labels", () => {
  it("route its hostname over HTTPS, to its service's shared load balancer, with retries", () => {
    expect(deploymentLabels(job, "apps.trylift.dev")).toEqual({
      "traefik.enable": "true",
      "traefik.docker.network": "lift-edge",
      [`${router}.rule`]: "Host(`web-demo-shop.apps.trylift.dev`)",
      [`${router}.entrypoints`]: "websecure",
      [`${router}.tls`]: "true",
      // One Traefik service per Lift service: old and new containers share it during a swap.
      [`${router}.service`]: `svc-${job.serviceId}`,
      [`${router}.middlewares`]: "retry-dep_aaaaaaaaaaaaaaaaaa1b2c3d",
      "traefik.http.middlewares.retry-dep_aaaaaaaaaaaaaaaaaa1b2c3d.retry.attempts": "3",
      "traefik.http.middlewares.retry-dep_aaaaaaaaaaaaaaaaaa1b2c3d.retry.initialinterval": "100ms",
      [`traefik.http.services.svc-${job.serviceId}.loadbalancer.server.port`]: "3000",
      "lift.project": job.projectId,
      "lift.service": job.serviceId,
      "lift.deployment": job.deploymentId,
    });
  });

  it("use plain HTTP on `web` for *.localhost, and match every hostname", () => {
    const local = deploymentLabels(
      { ...job, hostnames: ["web-demo-shop.apps.localhost", "shop.example.test"] },
      "apps.localhost",
    );
    expect(local[`${router}.entrypoints`]).toBe("web");
    expect(local).not.toHaveProperty(`${router}.tls`);
    expect(local[`${router}.rule`]).toBe(
      "Host(`web-demo-shop.apps.localhost`) || Host(`shop.example.test`)",
    );
  });

  it("name the container after the service and the deployment", () => {
    expect(containerName("web", job.deploymentId)).toBe("lift-web-1b2c3d");
  });
});

describe("a deployment's container", () => {
  const spec = containerSpec(
    job,
    [
      { key: "PORT", value: "3000", source: "system" },
      { key: "LIFT_DEPLOYMENT_ID", value: job.deploymentId, source: "system" },
    ],
    "apps.trylift.dev",
  );

  it("gets its environment, image and labels", () => {
    expect(spec.Image).toBe(job.imageTag);
    expect(spec.Env).toEqual(["PORT=3000", `LIFT_DEPLOYMENT_ID=${job.deploymentId}`]);
    expect(spec.Labels["lift.deployment"]).toBe(job.deploymentId);
  });

  it("has hard limits: 0.5 vCPU, 512 MB with no extra swap, 256 processes", () => {
    expect(spec.HostConfig).toMatchObject({
      NanoCpus: 500_000_000,
      Memory: 536_870_912,
      MemorySwap: 536_870_912,
      PidsLimit: 256,
    });
  });

  it("is hardened: no privilege escalation, no raw sockets, logs capped", () => {
    expect(spec.HostConfig).toMatchObject({
      SecurityOpt: ["no-new-privileges:true"],
      CapDrop: ["NET_RAW"],
      // Restarts come on once it's healthy, so a crash during the check keeps its exit code.
      RestartPolicy: { Name: "no" },
      LogConfig: { Type: "json-file", Config: { "max-size": "10m", "max-file": "3" } },
    });
    // INF-11: never privileged, never on the host's network, never with a mount.
    expect(spec.HostConfig).not.toHaveProperty("Privileged");
    expect(spec.HostConfig).not.toHaveProperty("Binds");
    expect(spec.HostConfig).not.toHaveProperty("Mounts");
    expect(spec.HostConfig.NetworkMode).toBe("lift-edge");
  });

  it("joins lift-edge and its project's network under the service's slug", () => {
    expect(spec.NetworkingConfig.EndpointsConfig).toEqual({
      "lift-edge": {},
      [`lift-prj-${job.projectId}`]: { Aliases: ["web"] },
    });
  });
});

describe("the health probe's answer", () => {
  it.each([
    [0, "200 0.038", { healthy: true, status: 200, ms: 38 }],
    [0, "404 0.002", { healthy: true, status: 404 }],
    [0, "500 0.010", { healthy: false, status: 500, reason: "answered 500" }],
    [0, "502 0.001", { healthy: false, reason: "answered 502" }],
    [7, "000 0.000", { healthy: false, status: null, reason: "connection refused" }],
    [28, "000 2.001", { healthy: false, reason: "no answer within 2s" }],
    [3, "", { healthy: false, reason: "no answer (curl exited with 3)" }],
  ])("curl exit %d, output %j", (exitCode, stdout, expected) => {
    expect(readProbe(exitCode, stdout)).toMatchObject(expected);
  });
});
