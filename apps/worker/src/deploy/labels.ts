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
 * named `dep-{deploymentId}` matching every hostname, on `websecure` with TLS (the wildcard
 * certificate) or, for `*.localhost`, plain `web`; plus the `lift.*` labels the worker finds its
 * containers by.
 *
 * Every deployment of a service joins one Traefik service, `svc-{serviceId}`, so during a swap the
 * old and the new container sit in one load balancer, whichever router Traefik follows. The
 * router retries a request that couldn't connect (a container still starting, or just removed)
 * on another container, so no request fails during a redeploy. The retry middleware is named
 * after the deployment, so containers made by different worker releases never share (and so can
 * never disagree about) one definition.
 */
export function deploymentLabels(job: DeployJob, appsDomain: string): Record<string, string> {
  const routing = appsRouting(appsDomain);
  const name = `dep-${job.deploymentId}`;
  const router = `traefik.http.routers.${name}`;
  const service = `svc-${job.serviceId}`;
  const retry = `retry-${job.deploymentId}`;
  return {
    "traefik.enable": "true",
    "traefik.docker.network": EDGE_NETWORK,
    [`${router}.rule`]: job.hostnames.map((hostname) => `Host(\`${hostname}\`)`).join(" || "),
    [`${router}.entrypoints`]: routing.entryPoint,
    ...(routing.tls ? { [`${router}.tls`]: "true" } : {}),
    [`${router}.service`]: service,
    [`${router}.middlewares`]: retry,
    [`traefik.http.middlewares.${retry}.retry.attempts`]: "3",
    [`traefik.http.middlewares.${retry}.retry.initialinterval`]: "100ms",
    [`traefik.http.services.${service}.loadbalancer.server.port`]: String(job.port),
    "lift.project": job.projectId,
    "lift.service": job.serviceId,
    "lift.deployment": job.deploymentId,
  };
}
