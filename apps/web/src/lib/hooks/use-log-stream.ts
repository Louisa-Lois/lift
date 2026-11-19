"use client";

import { type DeploymentStatus, isLiftApiError, type LogEntry } from "@lift/shared";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { appendLines } from "@/lib/log-buffer";
import { reconnectDelay, wait } from "@/lib/reconnect";

export type LogStreamState = "connecting" | "live" | "reconnecting" | "ended";

export interface LogStream {
  lines: LogEntry[];
  state: LogStreamState;
  /** The status the deployment ended in, from the stream's `end` event. */
  endStatus: DeploymentStatus | null;
}

/** Lines are applied at most this often, so a replay of thousands renders a few times, not thousands. */
const FLUSH_MS = 100;

/**
 * A deployment's log, live (docs/prd/02-frontend.md, "Deployment page"): replays from the first
 * line, follows, and stops at `end`. When the connection drops it reconnects after 1, 2, 5, then
 * 10 seconds, resuming after the last line it holds (Last-Event-ID), so no line shows twice.
 */
export function useLogStream(deploymentId: string): LogStream {
  const [lines, setLines] = useState<LogEntry[]>([]);
  const [state, setState] = useState<LogStreamState>("connecting");
  const [endStatus, setEndStatus] = useState<DeploymentStatus | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let pending: LogEntry[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastId: string | undefined;
    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      const batch = pending;
      pending = [];
      if (batch.length > 0) setLines((current) => appendLines(current, batch));
    };

    setLines([]);
    setState("connecting");
    setEndStatus(null);

    void (async () => {
      for (let attempt = 0; !controller.signal.aborted; ) {
        try {
          const messages = api.deployments.streamLogs(deploymentId, {
            signal: controller.signal,
            ...(lastId ? { lastEventId: lastId } : {}),
          });
          for await (const message of messages) {
            attempt = 0;
            setState("live");
            if (message.event === "end") {
              flush();
              setEndStatus(message.data.status);
              setState("ended");
              return;
            }
            if (message.id) {
              pending.push({ id: message.id, ...message.data });
              lastId = message.id;
              timer ??= setTimeout(flush, FLUSH_MS);
            }
          }
          // Closed without `end` (the API restarted): reconnect.
        } catch (error) {
          if (controller.signal.aborted) return;
          // Gone, or no longer ours to see: nothing to follow.
          if (isLiftApiError(error) && [401, 403, 404].includes(error.status)) {
            flush();
            setState("ended");
            return;
          }
        }
        if (controller.signal.aborted) return;
        flush();
        setState("reconnecting");
        await wait(reconnectDelay(attempt), controller.signal);
        attempt += 1;
      }
    })();

    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [deploymentId]);

  return { lines, state, endStatus };
}
