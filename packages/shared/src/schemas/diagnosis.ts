// ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
// │ STUB: AI-00 (Lyse) owns Diagnosis. Fields come from docs/prd/03-ai-agent.md, "Autofix",     │
// │ step 6. `actions` items are left open until AI-00 defines them.                              │
// └─────────────────────────────────────────────────────────────────────────────────────────────┘
import { z } from "zod";
import { DiagnosisStatus, FailureCategory } from "../enums";
import { DeploymentId, DiagnosisId } from "../ids";
import { Timestamp } from "./common";

/** `GET /deployments/:id/diagnosis`: the AI's explanation of a failed deployment. */
export const Diagnosis = z.object({
  id: DiagnosisId,
  deploymentId: DeploymentId,
  category: FailureCategory,
  /** One sentence. */
  summary: z.string(),
  /** Line numbers in the deployment's build log. */
  evidence: z.array(z.number().int().positive()),
  actions: z.array(z.unknown()),
  attempt: z.number().int().min(1),
  status: DiagnosisStatus,
  createdAt: Timestamp,
});
export type Diagnosis = z.infer<typeof Diagnosis>;

/** `POST /internal/v1/agent/diagnoses` (agent service only). */
export const CreateDiagnosisBody = Diagnosis.omit({ id: true, createdAt: true });
export type CreateDiagnosisBody = z.infer<typeof CreateDiagnosisBody>;
