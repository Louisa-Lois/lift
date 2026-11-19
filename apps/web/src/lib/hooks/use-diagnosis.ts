"use client";

import { isLiftApiError } from "@lift/shared";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** How long a failed deployment's page waits for autofix's diagnosis before it stops asking. */
export const DIAGNOSIS_WAIT_MS = 3 * 60_000;

/**
 * A failed deployment's diagnosis (FE-16), or null before autofix wrote one. While `waiting`, it
 * asks again every 5 seconds; the `diagnosis.created` event usually fills it in sooner.
 */
export function useDiagnosis(
  deploymentId: string,
  options: { enabled: boolean; waiting: boolean },
) {
  return useQuery({
    queryKey: queryKeys.diagnosis(deploymentId),
    queryFn: async () => {
      try {
        return await api.deployments.diagnosis(deploymentId);
      } catch (error) {
        if (isLiftApiError(error) && error.status === 404) return null;
        throw error;
      }
    },
    enabled: options.enabled,
    refetchInterval: (query) => (query.state.data === null && options.waiting ? 5_000 : false),
  });
}
