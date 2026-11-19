/**
 * @lift/shared: the contracts every Lift app shares, frozen as contracts v1 on Nov 18 (git tag
 * `contracts-v1`; see docs/contracts.md). Change this package only through an issue labelled
 * `interface`; after the freeze, only additive changes go in without every owner's approval.
 *
 * Sample data for mocks and tests is a separate entry point: `@lift/shared/fixtures`.
 */

export * from "./apps";
export * from "./client";
export * from "./enums";
export * from "./errors";
export * from "./events";
export * from "./ids";
export * from "./internal";
export * from "./jobs";
export * from "./rollback";
export * from "./schemas";

/** Base path of every public API route. */
export const API_BASE_PATH = "/api/v1";

/** Base path of the internal routes the worker and the agent service call. Never routed publicly. */
export const INTERNAL_BASE_PATH = "/internal/v1";

/** Ports in development. Each container listens on the same number in production. */
export const DEV_PORTS = {
  web: 3000,
  api: 4000,
  agent: 4100,
  collab: 4200,
  mcp: 4300,
} as const;
