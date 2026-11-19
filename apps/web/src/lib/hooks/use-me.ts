"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** The signed-in user, or an error (401) when nobody is signed in. */
export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: () => api.me(), retry: false });
}
