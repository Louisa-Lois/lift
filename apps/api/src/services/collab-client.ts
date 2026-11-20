import {
  COLLAB_INTERNAL_ROUTES,
  type CollabResetBody,
  CollabResetResponse,
  type CollabTextBody,
  CollabTextResponse,
} from "@lift/shared";
import type { z } from "zod";
import { problem } from "../lib/problem";

/** The collab server reads or resets 50 small documents in well under a second. */
export const COLLAB_TIMEOUT_MS = 10_000;

export interface CollabClientOptions {
  /** COLLAB_URL: http://collab:4200 in production. */
  url: string;
  secret: string | undefined;
  /** Tests answer like the collab server. */
  fetch?: typeof globalThis.fetch | undefined;
  timeoutMs?: number;
}

export type CollabClient = ReturnType<typeof createCollabClient>;

/**
 * The collab server's internal routes, called with COLLAB_SECRET (decision 3 of the Nov 26 plan):
 * the live text of a document lives there, and the database copy lags it by up to 10 seconds.
 */
export function createCollabClient(options: CollabClientOptions) {
  const fetchFn = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const base = options.url.replace(/\/+$/, "");

  async function post<T>(route: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    if (!options.secret) {
      throw problem(
        "upstream_unavailable",
        "The live editor isn't set up on this server (COLLAB_SECRET).",
      );
    }
    let response: Response;
    try {
      response = await fetchFn(`${base}${route}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${options.secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs ?? COLLAB_TIMEOUT_MS),
      });
    } catch (error) {
      throw problem("upstream_unavailable", "The live editor's server didn't answer.", {
        cause: error,
      });
    }
    if (!response.ok) {
      throw problem(
        "upstream_unavailable",
        `The live editor's server answered ${response.status}.`,
      );
    }
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      throw problem(
        "upstream_unavailable",
        "The live editor's server answered something unexpected.",
      );
    }
    return parsed.data;
  }

  return {
    /** Each document's live text, unsaved edits included; null for a name with no row. */
    async texts(names: string[]): Promise<Record<string, string | null>> {
      if (names.length === 0) return {};
      const body: CollabTextBody = { names };
      return (await post(COLLAB_INTERNAL_ROUTES.text, body, CollabTextResponse)).texts;
    },
    /** Replaces each document's text, for everyone editing it, and saves it. */
    async reset(documents: CollabResetBody["documents"]): Promise<CollabResetResponse> {
      if (documents.length === 0) return { reset: [], missing: [] };
      const body: CollabResetBody = { documents };
      return post(COLLAB_INTERNAL_ROUTES.reset, body, CollabResetResponse);
    },
  };
}
