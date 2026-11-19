"use client";

import type { CursorPage, Variable } from "@lift/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** A service's variables, sorted by key, values masked. */
export function useVariables(serviceId: string) {
  return useQuery({
    queryKey: queryKeys.variables(serviceId),
    queryFn: () => api.variables.list(serviceId),
  });
}

/**
 * The same with values in plaintext (editors only). Fetched only while something on screen shows
 * a value, and dropped from the cache a minute after nothing does.
 */
export function useRevealedVariables(serviceId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.revealedVariables(serviceId),
    queryFn: () => api.variables.list(serviceId, { reveal: true }),
    enabled,
    staleTime: 0,
    gcTime: 60_000,
  });
}

/** Saves staged changes: a value sets a key, null deletes it. They apply on the next deploy. */
export function useSaveVariables(serviceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: Record<string, string | null>) =>
      api.variables.upsert(serviceId, { variables: changes }),
    onSuccess: (result) => {
      queryClient.setQueryData<CursorPage<Variable>>(queryKeys.variables(serviceId), {
        data: result.variables,
        nextCursor: null,
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.revealedVariables(serviceId) });
    },
  });
}
