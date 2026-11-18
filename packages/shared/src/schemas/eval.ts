// ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
// │ STUB: AI-00/AI-05 (Lyse) owns EvalRun and EvalResult ("per-run summary, per-repo outcome"). │
// │ Only the IDs are fixed; the scores in docs/prd/03-ai-agent.md land here in AI-05.            │
// └─────────────────────────────────────────────────────────────────────────────────────────────┘
import { z } from "zod";
import { DeploymentId, EvalResultId, EvalRunId } from "../ids";
import { Timestamp } from "./common";

/** `GET /evals/runs`. */
export const EvalRun = z.looseObject({
  id: EvalRunId,
  summary: z.unknown(),
  createdAt: Timestamp,
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalResult = z.looseObject({
  id: EvalResultId,
  runId: EvalRunId,
  /** The case's ID in evals/repos.json, e.g. `next-postgres-01`. */
  caseId: z.string().min(1),
  deploymentId: DeploymentId.nullable(),
  outcome: z.unknown(),
});
export type EvalResult = z.infer<typeof EvalResult>;

/** `GET /evals/runs/:id`. */
export const EvalRunDetail = EvalRun.extend({ results: z.array(EvalResult) });
export type EvalRunDetail = z.infer<typeof EvalRunDetail>;

/** `POST /internal/v1/evals/runs` (agent service only). */
export const CreateEvalRunBody = z.looseObject({
  summary: z.unknown(),
  results: z.array(
    z.looseObject({
      caseId: z.string().min(1),
      deploymentId: DeploymentId.nullable(),
      outcome: z.unknown(),
    }),
  ),
});
export type CreateEvalRunBody = z.infer<typeof CreateEvalRunBody>;
