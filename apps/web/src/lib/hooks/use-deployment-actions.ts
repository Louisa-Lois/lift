"use client";

import type { Deployment } from "@lift/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** After any of these, the service's deployments and the project change; the stream follows. */
function useRefresh() {
  const queryClient = useQueryClient();
  return (deployment: Pick<Deployment, "id" | "serviceId" | "projectId">) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.deployments(deployment.serviceId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.deployment(deployment.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.project(deployment.projectId) });
  };
}

/** A new deployment running this one's image, with today's variables; no build. */
export function useRollback() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (deploymentId: string) => api.deployments.rollback(deploymentId),
    onSuccess: refresh,
  });
}

/** While it's queued or building. */
export function useCancelDeployment() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (deploymentId: string) => api.deployments.cancel(deploymentId),
    onSuccess: refresh,
  });
}

/** Builds this deployment's commit again, with today's variables. */
export function useRedeploy() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (deployment: Pick<Deployment, "serviceId" | "commitSha">) =>
      api.deployments.create(deployment.serviceId, { commitSha: deployment.commitSha }),
    onSuccess: refresh,
  });
}

/** Restarts the running container: same image and variables. */
export function useRestartService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (serviceId: string) => api.services.restart(serviceId),
    onSuccess: (service) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(service.projectId) });
    },
  });
}
