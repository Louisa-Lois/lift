import { appsRouting, type DeployJob } from "@lift/shared";

/** Shared by Traefik and every app container; lift-release.sh (or `pnpm stack:up`) creates it. */
export const EDGE_NETWORK = "lift-edge";

/** A project's private network: its services reach each other by service slug. */
export const projectNetwork = (projectId: string) => `lift-prj-${projectId}`;

/** `lift-{serviceSlug}-{last 6 of deploymentId}` (docs/contracts.md, "Worker jobs"). */
export const containerName = (serviceSlug: string, deploymentId: string) =>
  `lift-${serviceSlug}-${deploymentId.slice(-6)}`;

/**
 * Traefik's labels for one deployment (docs/prd/04-infrastructure.md, "Deploy job"): a router
 * and service named `dep-{deploymentId}` matching every hostname, on `websecure` with TLS (the
 * wildcard certificate) or, for `*.localhost`, plain `web`; plus the `lift.*` labels the worker
 * finds its containers by.
 */
export function deploymentLabels(job: DeployJob, appsDomain: string): Record<string, string> {
  const routing = appsRouting(appsDomain);
  const name = `dep-${job.deploymentId}`;
  const router = `traefik.http.routers.${name}`;
  return {
    "traefik.enable": "true",
    "traefik.docker.network": EDGE_NETWORK,
    [`${router}.rule`]: job.hostnames.map((hostname) => `Host(\`${hostname}\`)`).join(" || "),
    [`${router}.entrypoints`]: routing.entryPoint,
    ...(routing.tls ? { [`${router}.tls`]: "true" } : {}),
    [`${router}.service`]: name,
    [`traefik.http.services.${name}.loadbalancer.server.port`]: String(job.port),
    "lift.project": job.projectId,
    "lift.service": job.serviceId,
    "lift.deployment": job.deploymentId,
  };
}
