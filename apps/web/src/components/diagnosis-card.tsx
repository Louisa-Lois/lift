"use client";

import {
  AUTOFIX_ERROR_CODES,
  AUTOFIX_MAX_FIXES,
  type Deployment,
  type Diagnosis,
  type FailureCategory,
  type LogEntry,
} from "@lift/shared";
import { Loader2Icon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { AnsiLine } from "@/components/ansi-line";
import { Badge } from "@/components/ui/badge";
import { DIAGNOSIS_WAIT_MS } from "@/lib/hooks/use-diagnosis";

const CATEGORY: Record<FailureCategory, string> = {
  missing_env_var: "Missing variable",
  wrong_port: "Wrong port",
  wrong_start_command: "Wrong start command",
  wrong_build_command: "Wrong build command",
  node_version: "Node version",
  python_version: "Python version",
  missing_dependency: "Missing dependency",
  lockfile_mismatch: "Lockfile mismatch",
  healthcheck_timeout: "Health check timeout",
  out_of_memory: "Out of memory",
  code_error: "Code error",
  unknown: "Unclear",
};

/**
 * Whether autofix may still be looking at a failure: the app's own failure (not Lift's), on a
 * service with autofix on, that ended less than three minutes ago.
 */
export function awaitingDiagnosis(deployment: Deployment, autofix: boolean, now: number): boolean {
  if (deployment.status !== "failed" || !autofix || !deployment.errorCode) return false;
  if (!(AUTOFIX_ERROR_CODES as readonly string[]).includes(deployment.errorCode)) return false;
  const finished = deployment.finishedAt ? Date.parse(deployment.finishedAt) : 0;
  return now - finished < DIAGNOSIS_WAIT_MS;
}

/**
 * The AI diagnosis card on a failed deployment (FE-16, docs/prd/02-frontend.md): what went wrong
 * in one sentence, the evidence lines (each jumps to its place in the log), what Lift did (the
 * attempt, the changes, the redeploy) or suggests, and what's left to the user.
 */
export function DiagnosisCard({
  projectId,
  diagnosis,
  waiting,
  lines,
  onEvidence,
}: {
  projectId: string;
  diagnosis: Diagnosis | null | undefined;
  waiting: boolean;
  lines: LogEntry[];
  onEvidence: (line: number) => void;
}) {
  if (!diagnosis) {
    if (!waiting) return null;
    return (
      <section
        aria-label="AI diagnosis"
        className="flex items-center gap-2 rounded-lg border px-4 py-3 text-muted-foreground text-sm"
      >
        <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
        Lift is looking at this failure…
      </section>
    );
  }
  const done = diagnosis.actions.filter((action) => action.status === "completed");
  const proposed = diagnosis.actions.filter((action) => action.status === "proposed");
  return (
    <section
      aria-label="AI diagnosis"
      className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <SparklesIcon className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="font-medium">What went wrong</h2>
        <Badge variant="outline">{CATEGORY[diagnosis.category]}</Badge>
      </div>
      <p>{diagnosis.summary}</p>
      {diagnosis.evidence.length > 0 ? (
        <ul
          aria-label="Evidence"
          className="flex flex-col rounded-md bg-muted/50 py-1 font-mono text-xs"
        >
          {diagnosis.evidence.map((n) => (
            <li key={n}>
              <button
                type="button"
                onClick={() => onEvidence(n)}
                className="flex w-full gap-3 px-2 py-0.5 text-left hover:bg-muted"
              >
                <span className="shrink-0 text-muted-foreground">line {n}</span>
                <span className="min-w-0 truncate">
                  <AnsiLine text={lines[n - 1]?.line ?? ""} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {done.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="font-medium">
            Attempt {diagnosis.attempt} of {AUTOFIX_MAX_FIXES}: what Lift did
          </p>
          <ul className="list-disc pl-5">
            {done.map((action) => (
              <li key={`${action.id}-${action.summary}`}>
                {action.summary}
                {action.deploymentId ? (
                  <>
                    {" · "}
                    <Link
                      href={`/p/${projectId}/deployments/${action.deploymentId}`}
                      className="underline underline-offset-4"
                    >
                      Open the new deployment
                    </Link>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {proposed.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="font-medium">Suggestions Lift didn't apply</p>
          <ul className="list-disc pl-5">
            {proposed.map((action) => (
              <li key={`${action.id}-${action.summary}`}>{action.summary}</li>
            ))}
          </ul>
          <p className="text-muted-foreground text-xs">
            Change them in the service's settings or Variables, then deploy.
          </p>
        </div>
      ) : null}
      {diagnosis.status === "needs_human" ? (
        <p className="text-muted-foreground">
          Lift didn't change anything. The lines above show where to look; once it's fixed, deploy
          again.
        </p>
      ) : null}
    </section>
  );
}
