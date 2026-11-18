/**
 * @lift/shared/fixtures: one realistic demo project for mocks and tests. Every object is built
 * through its schema in this package, so if a schema changes and a fixture no longer fits,
 * importing this module fails, and so does `pnpm test`.
 *
 * Not for production code: import it only from mocks (apps/web/src/mocks) and tests.
 */
import type { CursorPage } from "../schemas/common";

export { buildLog, deploymentLogs, failedBuildLog } from "./build-log";
export {
  allDeployments,
  database,
  databaseCredentials,
  deploymentDetails,
  deployments,
  domains,
  events,
  me,
  members,
  project,
  projectListItem,
  revealedVariables,
  runtimeEnv,
  services,
  users,
  variables,
} from "./demo";
export { githubBranches, githubRepos } from "./github";
export { fixtureIds } from "./ids";

/** Wraps a list the way list routes answer: `{ data, nextCursor }`. */
export function page<T>(data: T[], nextCursor: string | null = null): CursorPage<T> {
  return { data, nextCursor };
}
