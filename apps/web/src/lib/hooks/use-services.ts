"use client";

import type { CreateServiceBody, UpdateServiceBody } from "@lift/shared";
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

/**
 * `PATCH /services/:id`: a settings change, used from the next deploy on. The answer replaces the
 * service in the cache, and the project refetches.
 */
export function useUpdateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ serviceId, body }: { serviceId: string; body: UpdateServiceBody }) =>
      api.services.update(serviceId, body),
    onSuccess: (service) => {
      queryClient.setQueryData(queryKeys.service(service.id), service);
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(service.projectId) });
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
