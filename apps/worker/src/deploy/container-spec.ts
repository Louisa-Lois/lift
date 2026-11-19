import type { DeployJob, RuntimeEnvVariable } from "@lift/shared";
import type { ContainerCreateBody } from "../docker";
import { deploymentLabels, EDGE_NETWORK, projectNetwork } from "./labels";

export const PIDS_LIMIT = 256;

/**
 * The container for a deployment (docs/prd/04-infrastructure.md, "Deploy job" and "Security
 * hardening"): its environment from runtime-env; hard CPU and memory limits with no extra swap;
 * at most 256 processes; no privilege escalation and no raw sockets; logs capped at 3 × 10 MB;
 * on lift-edge for Traefik and on the project network under the service's slug. Never
 * privileged, never on the host network, never with a mount.
 *
 * It starts with no restart policy: the deploy job switches it to `unless-stopped` once the app
 * is healthy, so a crash during the health check keeps its real exit code and shows its output
 * once, instead of being hidden by restarts.
 */
export function containerSpec(
  job: DeployJob,
  variables: RuntimeEnvVariable[],
  appsDomain: string,
): ContainerCreateBody {
  const memory = job.memoryMb * 1024 * 1024;
  return {
    Image: job.imageTag,
    Env: variables.map((variable) => `${variable.key}=${variable.value}`),
    Labels: deploymentLabels(job, appsDomain),
    HostConfig: {
      NanoCpus: Math.round(job.cpu * 1e9),
      Memory: memory,
      MemorySwap: memory,
      PidsLimit: PIDS_LIMIT,
      SecurityOpt: ["no-new-privileges:true"],
      CapDrop: ["NET_RAW"],
      RestartPolicy: { Name: "no" },
      LogConfig: { Type: "json-file", Config: { "max-size": "10m", "max-file": "3" } },
      NetworkMode: EDGE_NETWORK,
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [EDGE_NETWORK]: {},
        [projectNetwork(job.projectId)]: { Aliases: [job.serviceSlug] },
      },
    },
  };
}
