"use client";

import type { CreateServiceBody } from "@lift/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** `POST /projects/:id/services`; the project and the projects list refetch afterwards. */
export function useCreateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, body }: { projectId: string; body: CreateServiceBody }) =>
      api.services.create(projectId, body),
    onSuccess: (service) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(service.projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
  });
}

/** One service, with its URL and latest deployment. Waits while `serviceId` is null. */
export function useService(serviceId: string | null) {
  return useQuery({
    queryKey: queryKeys.service(serviceId ?? ""),
    queryFn: () => api.services.get(serviceId ?? ""),
    enabled: serviceId !== null,
  });
}
