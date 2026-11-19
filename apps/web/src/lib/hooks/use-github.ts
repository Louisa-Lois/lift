"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** `value`, once it has stopped changing for `ms` milliseconds (search boxes). */
export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** Repos you can access; `query` searches owner/name. Keeps the last list while typing. */
export function useRepos(query: string) {
  return useQuery({
    queryKey: queryKeys.githubRepos(query),
    queryFn: () => api.github.repos({ query: query || undefined, limit: 30 }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

/** A repo's branches, once a repo is picked. */
export function useBranches(repo: { owner: string; name: string } | null) {
  return useQuery({
    queryKey: queryKeys.githubBranches(repo?.owner ?? "", repo?.name ?? ""),
    queryFn: () => api.github.branches(repo?.owner ?? "", repo?.name ?? ""),
    enabled: repo !== null,
    staleTime: 60_000,
  });
}
