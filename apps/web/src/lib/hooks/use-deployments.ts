"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** A service's recent deployments, newest first; waits while `serviceId` is still unknown (""). */
export function useDeployments(serviceId: string, limit = 5) {
  return useQuery({
    queryKey: queryKeys.deployments(serviceId),
    queryFn: () => api.deployments.list(serviceId, { limit }),
    enabled: serviceId !== "",
  });
}

/** One deployment with its timeline. */
export function useDeployment(deploymentId: string) {
  return useQuery({
    queryKey: queryKeys.deployment(deploymentId),
    queryFn: () => api.deployments.get(deploymentId),
  });
}

/** "Deploy": the branch head, as a new deployment (202 with it queued). */
export function useDeploy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (serviceId: string) => api.deployments.create(serviceId, {}),
    onSuccess: (deployment) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.deployments(deployment.serviceId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(deployment.projectId) });
    },
  });
}
