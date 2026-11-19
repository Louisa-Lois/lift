"use client";

import type { CreateTokenBody } from "@lift/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** Your personal tokens (the first 100), newest first. The list never holds a token itself. */
export function useTokens() {
  return useQuery({
    queryKey: queryKeys.tokens,
    queryFn: () => api.tokens.list({ limit: 100 }),
  });
}

/**
 * Creates a token. Its answer holds the plaintext, so the mutation keeps nothing once it's done
 * (`gcTime: 0`): the new-token dialog copies it into its own state and resets the mutation.
 */
export function useCreateToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTokenBody) => api.tokens.create(body),
    gcTime: 0,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.tokens }),
  });
}

export function useRevokeToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => api.tokens.revoke(tokenId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.tokens }),
  });
}
