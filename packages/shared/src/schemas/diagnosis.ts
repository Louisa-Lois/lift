// ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
// │ AI-00 (Lyse) owns Diagnosis. Fields come from docs/prd/03-ai-agent.md, "Autofix", step 6.    │
// │ AI-06 defined the items of `actions` and the body the agent sends.                           │
// └─────────────────────────────────────────────────────────────────────────────────────────────┘
import { z } from "zod";
import { AutofixChange } from "../autofix";
import { DiagnosisStatus, FailureCategory } from "../enums";
import { AgentActionId, DeploymentId, DiagnosisId } from "../ids";
import { Timestamp } from "./common";

/** What the assistant did, or proposes, about a failure: one line each, for the card. */
export const DiagnosisAction = z.object({
  id: AgentActionId,
  /** `update_service_settings`, `set_variables` or `deploy`. */
  tool: z.string().min(1),
  /** "Set the port to 8080", "Redeployed 3f9c2a1". */
  summary: z.string(),
  status: z.enum(["completed", "proposed"]),
  /** The deployment a `deploy` action started. */
  deploymentId: DeploymentId.nullable(),
});
export type DiagnosisAction = z.infer<typeof DiagnosisAction>;

/** `GET /deployments/:id/diagnosis`: the AI's explanation of a failed deployment. */
export const Diagnosis = z.object({
  id: DiagnosisId,
  deploymentId: DeploymentId,
  category: FailureCategory,
  /** One sentence. */
  summary: z.string(),
  /** Line numbers in the deployment's build log. */
  evidence: z.array(z.number().int().positive()),
  actions: z.array(DiagnosisAction),
  /** Which fix in a chain of failures this is: 1 for a first failure. */
  attempt: z.number().int().min(1),
  /** `fixed`: Lift changed something and redeployed; `proposed`: only suggestions; `needs_human`. */
  status: DiagnosisStatus,
  createdAt: Timestamp,
});
export type Diagnosis = z.infer<typeof Diagnosis>;

/**
 * `POST /internal/v1/agent/diagnoses` (agent service only). The API checks each change against
 * the autofix rules again, applies those it allows and redeploys, records the rest as proposals,
 * and works out the attempt and the status itself.
 */
export const CreateDiagnosisBody = z.strictObject({
  deploymentId: DeploymentId,
  category: FailureCategory,
  summary: z.string().trim().min(1).max(500),
  evidence: z.array(z.number().int().positive()).max(20),
  /** Changes for Lift to make now, then redeploy. */
  changes: z.array(AutofixChange).max(10),
  /** Changes shown on the card and never applied. */
  proposals: z.array(AutofixChange).max(10),
});
export type CreateDiagnosisBody = z.infer<typeof CreateDiagnosisBody>;
