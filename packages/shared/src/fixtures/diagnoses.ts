import { Diagnosis } from "../schemas/diagnosis";
import { fixtureCommits, fixtureId, fixtureIds as ids } from "./ids";

/**
 * Autofix's diagnosis of the web service's failed build: Next.js 16 on Node 18, fixed by
 * switching the build to Node 22 and redeploying. The evidence points into `failedBuildLog`.
 */
export const diagnosis = Diagnosis.parse({
  id: fixtureId("dgn", "web-node-version"),
  deploymentId: ids.deployments.webFailed,
  category: "node_version",
  summary: "Next.js 16 needs Node 20.9 or later, but package.json's engines field pins Node 18.",
  evidence: [17, 88, 97],
  actions: [
    {
      id: ids.agentActions.setNodeVersion,
      tool: "set_variables",
      summary: "Set RAILPACK_NODE_VERSION to 22",
      status: "completed",
      deploymentId: null,
    },
    {
      id: ids.agentActions.redeployWeb,
      tool: "deploy",
      summary: `Redeployed ${fixtureCommits.webGrid.sha.slice(0, 7)}`,
      status: "completed",
      deploymentId: ids.deployments.webActive,
    },
  ],
  attempt: 1,
  status: "fixed",
  createdAt: "2026-11-17T14:17:41Z",
});
