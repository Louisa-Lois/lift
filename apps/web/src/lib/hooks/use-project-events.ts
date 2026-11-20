"use client";

import {
  type CursorPage,
  type Deployment,
  type DeploymentDetail,
  isLiftApiError,
  type ProjectEvent,
} from "@lift/shared";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent } from "react";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { reconnectDelay, wait } from "@/lib/reconnect";

/** Writes one event into the query cache, so lists and pages update without a reload. */
export function applyProjectEvent(queryClient: QueryClient, event: ProjectEvent): void {
  const project = queryKeys.project(event.projectId);
  switch (event.type) {
    case "deployment.created":
    case "deployment.status_changed": {
      const { previousStatus: _previous, ...deployment } = {
        previousStatus: undefined,
        ...event.data,
      } as Deployment & { previousStatus?: unknown };
      queryClient.setQueryData<DeploymentDetail>(queryKeys.deployment(deployment.id), (old) =>
        old ? { ...old, ...deployment } : old,
      );
      queryClient.setQueryData<CursorPage<Deployment>>(
        queryKeys.deployments(deployment.serviceId),
        (old) => {
          if (!old) return old;
          const known = old.data.some((item) => item.id === deployment.id);
          return {
            ...old,
            data: known
              ? old.data.map((item) => (item.id === deployment.id ? deployment : item))
              : [deployment, ...old.data],
          };
        },
      );
      // The timeline gained a step, and cards show the latest status: fetch those fresh.
      void queryClient.invalidateQueries({ queryKey: queryKeys.deployment(deployment.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.service(deployment.serviceId) });
      void queryClient.invalidateQueries({ queryKey: project });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      return;
    }
    case "service.created":
    case "service.updated":
    case "service.deleted":
    case "service.restarted":
      void queryClient.invalidateQueries({ queryKey: queryKeys.service(event.data.id) });
      void queryClient.invalidateQueries({ queryKey: project });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      return;
    case "member.changed":
      // BE-15: the members list, and the project, whose role may have changed for the viewer.
      void queryClient.invalidateQueries({ queryKey: queryKeys.members(event.projectId) });
      void queryClient.invalidateQueries({ queryKey: project });
      return;
    case "variables.changed":
      // Values never travel in events: refetch the (masked) list.
      void queryClient.invalidateQueries({ queryKey: queryKeys.variables(event.data.serviceId) });
      return;
    case "diagnosis.created":
      // FE-16: the card on the failed deployment's page shows it at once.
      queryClient.setQueryData(queryKeys.diagnosis(event.data.deploymentId), event.data);
      return;
    case "editor.committed":
      // BE-18: the committed files are no longer changes, for everyone in the editor.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.editorChanges(event.data.serviceId),
      });
      return;
    default:
      void queryClient.invalidateQueries({ queryKey: project });
  }
}

/**
 * Opens the project's event stream once per project page and applies every event to the cache
 * (docs/prd/02-frontend.md, "Talking to the API"). Reconnects with backoff, resuming after the
 * last event; after a gap it refetches the project, in case something was missed.
 */
export function useProjectEvents(
  projectId: string,
  /** Runs for each event once the cache has it, for a screen that says something about it. */
  onEvent?: (event: ProjectEvent) => void,
): void {
  const queryClient = useQueryClient();
  const notify = useEffectEvent((event: ProjectEvent) => onEvent?.(event));

  useEffect(() => {
    const controller = new AbortController();
    let lastId: string | undefined;
    void (async () => {
      for (let attempt = 0; !controller.signal.aborted; ) {
        try {
          const messages = api.projects.streamEvents(projectId, {
            signal: controller.signal,
            ...(lastId ? { lastEventId: lastId } : {}),
          });
          for await (const message of messages) {
            attempt = 0;
            if (message.id) lastId = message.id;
            applyProjectEvent(queryClient, message.data);
            notify(message.data);
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          if (isLiftApiError(error) && [401, 403, 404].includes(error.status)) return;
        }
        if (controller.signal.aborted) return;
        await wait(reconnectDelay(attempt), controller.signal);
        attempt += 1;
        void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      }
    })();
    return () => controller.abort();
  }, [projectId, queryClient]);
}
