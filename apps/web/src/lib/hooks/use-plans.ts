"use client";

import type { ApplyPlanBody, CreatePlanBody } from "@lift/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** A plan you asked for. It never changes, so it's never refetched. */
export function usePlan(planId: string) {
  return useQuery({
    queryKey: queryKeys.plan(planId),
    queryFn: () => api.plans.get(planId),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Asks the assistant to plan a repo (up to a minute), and keeps the answer for the review page. */
export function useCreatePlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePlanBody) => api.plans.create(body),
    onSuccess: (plan) => queryClient.setQueryData(queryKeys.plan(plan.id), plan),
  });
}

/**
 * Applies a plan. Its body holds what the user typed, so the mutation keeps nothing once it's
 * done (`gcTime: 0`), like the new-token dialog.
 */
export function useApplyPlan(planId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ApplyPlanBody) => api.plans.apply(planId, body),
    gcTime: 0,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
  });
}
