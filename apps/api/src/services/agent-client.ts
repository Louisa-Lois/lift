import {
  AGENT_USER_HEADER,
  type AgentPlanRequest,
  AgentPlanResponse,
  type ErrorCode,
  Problem,
} from "@lift/shared";
import { problem } from "../lib/problem";

/** How long the API waits for a plan: PRD 03 aims for 30 seconds and allows 60. */
export const PLAN_TIMEOUT_MS = 60_000;

/**
 * The agent's answers the API passes on as they are. Anything else (its token check failing,
 * say) is the server's problem, not the user's, and becomes `upstream_unavailable`.
 */
const PASSED_ON: ErrorCode[] = [
  "not_found",
  "validation_failed",
  "rate_limited",
  "github_error",
  "upstream_unavailable",
];

export interface AgentClientOptions {
  /** AGENT_URL: http://agent:4100 in production. */
  url: string;
  token: string | undefined;
  /** Tests answer like the agent service. */
  fetch?: typeof globalThis.fetch | undefined;
  timeoutMs?: number;
}

export type AgentClient = ReturnType<typeof createAgentClient>;

/** The agent service's internal routes, called with AGENT_SERVICE_TOKEN and the user's ID. */
export function createAgentClient(options: AgentClientOptions) {
  const fetchFn = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const base = options.url.replace(/\/+$/, "");

  return {
    /** BE-19: the agent's plan for a repo the user can read, at a commit the API resolved. */
    async plan(userId: string, body: AgentPlanRequest): Promise<AgentPlanResponse> {
      if (!options.token) {
        throw problem(
          "upstream_unavailable",
          "The assistant isn't set up on this server (AGENT_SERVICE_TOKEN).",
        );
      }
      let response: Response;
      try {
        response = await fetchFn(`${base}/plans`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${options.token}`,
            "Content-Type": "application/json",
            [AGENT_USER_HEADER]: userId,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(options.timeoutMs ?? PLAN_TIMEOUT_MS),
        });
      } catch (error) {
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        throw problem(
          "upstream_unavailable",
          timedOut
            ? "The assistant took more than a minute to plan this repo. Try again, or configure the service yourself."
            : "The assistant isn't reachable right now. Try again in a minute, or configure the service yourself.",
          { cause: error },
        );
      }
      if (!response.ok) {
        const answered = Problem.safeParse(await response.json().catch(() => null));
        if (answered.success && PASSED_ON.includes(answered.data.code)) {
          throw problem(answered.data.code, answered.data.detail);
        }
        throw problem("upstream_unavailable", `The assistant answered ${response.status}.`, {
          cause: answered.success ? answered.data : undefined,
        });
      }
      const plan = AgentPlanResponse.safeParse(await response.json().catch(() => null));
      if (!plan.success) {
        throw problem("upstream_unavailable", "The assistant's plan didn't fit the contract.", {
          cause: plan.error,
        });
      }
      return plan.data;
    },
  };
}
