"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** Adds the project's Postgres; the project stream reports when it's ready. */
export function useCreateDatabase(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name?: string) => api.databases.create(projectId, { type: "postgres", name }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
  });
}

export function useDeleteDatabase(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (databaseId: string) => api.databases.delete(databaseId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      // Its DATABASE_URL just left every service.
      void queryClient.invalidateQueries({ queryKey: ["variables"] });
    },
  });
}

/**
 * A database's connection string and password (editors), fetched only while the credentials
 * dialog is open and forgotten as soon as it closes.
 */
export function useDatabaseCredentials(databaseId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["database-credentials", databaseId],
    queryFn: () => api.databases.credentials(databaseId),
    enabled,
    gcTime: 0,
    staleTime: 0,
  });
}
