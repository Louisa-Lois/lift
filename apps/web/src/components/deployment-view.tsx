"use client";

import {
  type DeploymentErrorCode,
  type DeploymentStatus,
  type DeploymentTrigger,
  isLiftApiError,
  rollbackTarget,
} from "@lift/shared";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLinkIcon, GitCommitHorizontalIcon, RotateCcwIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  CancelDeploymentButton,
  RedeployButton,
  RollbackDialog,
} from "@/components/deployment-actions";
import { awaitingDiagnosis, DiagnosisCard } from "@/components/diagnosis-card";
import { EmptyState } from "@/components/empty-state";
import { LogViewer } from "@/components/log-viewer";
import { StatusBadge } from "@/components/status-badge";
import { Timeline } from "@/components/timeline";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, timeAgo } from "@/lib/format";
import { useDeployment, useDeployments } from "@/lib/hooks/use-deployments";
import { useDiagnosis } from "@/lib/hooks/use-diagnosis";
import { useLogStream } from "@/lib/hooks/use-log-stream";
import { useNow } from "@/lib/hooks/use-now";
import { useProjectEvents } from "@/lib/hooks/use-project-events";
import { useProject } from "@/lib/hooks/use-projects";
import { useService } from "@/lib/hooks/use-services";
import { queryKeys } from "@/lib/query-keys";

const IN_PROGRESS = new Set<DeploymentStatus>(["queued", "building", "deploying"]);

const TRIGGERS: Record<DeploymentTrigger, string> = {
  push: "Pushed",
  manual: "Deployed",
  rollback: "Rolled back",
  agent: "Deployed by the assistant",
  editor: "Committed in the editor",
  cli: "Deployed from the CLI",
};

const ERRORS: Record<DeploymentErrorCode, string> = {
  clone_failed: "The clone failed",
  build_failed: "The build failed",
  build_timeout: "The build took too long",
  image_missing: "The image is missing",
  healthcheck_failed: "The health check failed",
  crashed: "The app crashed",
  upstream_unavailable: "Lift had a problem",
};

/**
 * /p/[projectId]/deployments/[deploymentId] (FE-05): status, commit, trigger and duration; the
 * live log; the timeline; "Visit" once it's live. The status follows the project stream, and the
 * log's `end` refreshes it too.
 */
export function DeploymentView({
  projectId,
  deploymentId,
}: {
  projectId: string;
  deploymentId: string;
}) {
  useProjectEvents(projectId);
  const queryClient = useQueryClient();
  const project = useProject(projectId);
  const deployment = useDeployment(deploymentId);
  const service = useService(deployment.data?.serviceId ?? null);
  // The service's recent deployments (the list's cache), for the rollback rule and to know if a
  // build is running. The API checks the rule against all of them.
  const siblings = useDeployments(deployment.data?.serviceId ?? "");
  const logs = useLogStream(deploymentId);
  const running = deployment.data ? IN_PROGRESS.has(deployment.data.status) : false;
  const now = useNow(running);
  // FE-16: the diagnosis of a failure, and the line its evidence points at.
  const waitingClock = useNow(deployment.data?.status === "failed", 5_000);
  const waiting = deployment.data
    ? awaitingDiagnosis(deployment.data, service.data?.autofix ?? false, waitingClock)
    : false;
  const diagnosis = useDiagnosis(deploymentId, {
    enabled: deployment.data?.status === "failed",
    waiting,
  });
  const [highlight, setHighlight] = useState<number | null>(null);
  const logSection = useRef<HTMLElement>(null);
  const showLine = (line: number) => {
    setHighlight(line);
    logSection.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  useEffect(() => {
    if (logs.state === "ended") {
      void queryClient.invalidateQueries({ queryKey: queryKeys.deployment(deploymentId) });
    }
  }, [logs.state, deploymentId, queryClient]);

  if (deployment.isPending) {
    return (
      <div role="status" aria-label="Loading deployment" className="flex flex-col gap-6">
        <Skeleton className="h-16 w-96 max-w-full" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  }
  if (deployment.isError) {
    const missing = isLiftApiError(deployment.error) && deployment.error.status === 404;
    return (
      <EmptyState
        title={missing ? "Deployment not found" : "Couldn't load this deployment"}
        description={
          missing
            ? "It doesn't exist, or you aren't a member of its project."
            : "Check your connection and try again."
        }
        action={
          <Button asChild variant="outline">
            <Link href={`/p/${projectId}`}>Back to the project</Link>
          </Button>
        }
      />
    );
  }

  const d = deployment.data;
  const repo = service.data?.repo;
  const canEdit = project.data !== undefined && project.data.role !== "viewer";
  const others = siblings.data?.data ?? [];
  // The rule needs the deployment among its siblings; on page 1 it always is unless it's old.
  const rollback = others.some((other) => other.id === d.id) ? rollbackTarget(d, others) : null;
  const buildInProgress = others.some(
    (other) => other.status === "queued" || other.status === "building",
  );
  const sha = d.commitSha.slice(0, 7);
  const started = Date.parse(d.startedAt ?? d.queuedAt);
  const elapsed = formatDuration((d.finishedAt ? Date.parse(d.finishedAt) : now) - started);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <nav aria-label="Breadcrumb" className="flex gap-1.5 text-muted-foreground text-xs">
            <Link href="/projects" className="hover:text-foreground">
              Projects
            </Link>
            <span aria-hidden="true">/</span>
            <Link href={`/p/${projectId}`} className="hover:text-foreground">
              {project.data?.name ?? "Project"}
            </Link>
          </nav>
          <h1 className="flex flex-wrap items-center gap-3 font-heading font-semibold text-xl">
            {service.data?.name ?? "Deployment"}
            <StatusBadge status={d.status} />
          </h1>
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-sm">
            <GitCommitHorizontalIcon className="size-4 shrink-0" aria-hidden="true" />
            {repo ? (
              <a
                href={`https://github.com/${repo.owner}/${repo.name}/commit/${d.commitSha}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono hover:text-foreground"
              >
                {sha}
              </a>
            ) : (
              <span className="font-mono">{sha}</span>
            )}
            <span className="max-w-md truncate text-foreground">
              {d.commitMessage ?? "No commit message"}
            </span>
            <span>
              · {TRIGGERS[d.trigger]}
              {d.commitAuthor ? ` · ${d.commitAuthor}` : ""} · {timeAgo(d.createdAt)} ·{" "}
              {running ? `running for ${elapsed}` : `took ${elapsed}`}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (d.status === "queued" || d.status === "building") ? (
            <CancelDeploymentButton deployment={d} />
          ) : null}
          {canEdit && rollback?.ok && service.data ? (
            <RollbackDialog
              deployment={d}
              serviceName={service.data.name}
              buildInProgress={buildInProgress}
              trigger={
                <Button variant="outline">
                  <RotateCcwIcon aria-hidden="true" />
                  Rollback
                </Button>
              }
            />
          ) : null}
          {canEdit && !running ? <RedeployButton deployment={d} /> : null}
          {d.status === "active" && service.data ? (
            <Button asChild>
              <a href={service.data.url} target="_blank" rel="noreferrer">
                Visit
                <ExternalLinkIcon aria-hidden="true" />
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      {d.status === "failed" && d.errorCode ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
        >
          <span className="font-medium">{ERRORS[d.errorCode]}.</span>{" "}
          {d.errorMessage ?? "The log below has the details."}
        </div>
      ) : null}
      {d.status === "failed" ? (
        <DiagnosisCard
          projectId={projectId}
          diagnosis={diagnosis.data}
          waiting={waiting}
          lines={logs.lines}
          onEvidence={showLine}
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <section ref={logSection} aria-label="Logs" className="min-w-0 scroll-mt-4">
          <LogViewer lines={logs.lines} state={logs.state} highlight={highlight} />
        </section>
        <aside className="flex flex-col gap-3">
          <h2 className="font-medium text-muted-foreground text-sm">Timeline</h2>
          <Timeline steps={d.timeline} />
        </aside>
      </div>
    </div>
  );
}
