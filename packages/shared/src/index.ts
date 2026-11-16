/**
 * @lift/shared: the contracts every Lift app shares.
 *
 * Contracts v1 land here in BE-00 (IDs, enums, schemas, errors, events, job payloads, the typed
 * client and fixtures) and freeze on Nov 18 as the git tag `contracts-v1`; see docs/contracts.md.
 * Change this package only through an issue labelled `interface`.
 */

/** Base path of every public API route. */
export const API_BASE_PATH = "/api/v1";

/** Base path of the internal routes the worker and the agent service call. Never routed publicly. */
export const INTERNAL_BASE_PATH = "/internal/v1";

/** BullMQ queues on the control plane's Redis. */
export const QUEUE_NAMES = {
  build: "lift-build",
  deploy: "lift-deploy",
  ops: "lift-ops",
  agent: "lift-agent",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Ports in development. Each container listens on the same number in production. */
export const DEV_PORTS = {
  web: 3000,
  api: 4000,
  agent: 4100,
  collab: 4200,
  mcp: 4300,
} as const;
