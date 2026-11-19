import type { Deployment, DeploymentTrigger, RepoRef } from "@lift/shared";
import Link from "next/link";
import type { ReactNode } from "react";
import { StatusBadge } from "@/components/status-badge";
import { formatDuration, timeAgo } from "@/lib/format";

const TRIGGERS: Record<DeploymentTrigger, string> = {
  push: "Push",
  manual: "Manual",
  rollback: "Rollback",
  agent: "Assistant",
  editor: "Editor",
  cli: "CLI",
};

/** How long it took, or "—" while it hasn't finished. */
function took(deployment: Deployment): string {
  if (!deployment.finishedAt) return "—";
  const start = Date.parse(deployment.startedAt ?? deployment.queuedAt);
  return formatDuration(Date.parse(deployment.finishedAt) - start);
}

/**
 * One deployment in a list: status, short SHA linking to the commit on GitHub, the commit
 * message (linking to the deployment page), trigger and author, age and duration.
 */
export function DeploymentRow({
  deployment,
  repo,
  menu,
}: {
  deployment: Deployment;
  repo: RepoRef;
  /** The row's menu (View logs · Rollback to this · Copy ID), where the list offers one. */
  menu?: ReactNode;
}) {
  const sha = deployment.commitSha;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-sm">
      <StatusBadge status={deployment.status} className="w-24 justify-start" />
      <a
        href={`https://github.com/${repo.owner}/${repo.name}/commit/${sha}`}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-muted-foreground text-xs hover:text-foreground"
      >
        {sha.slice(0, 7)}
      </a>
      <Link
        href={`/p/${deployment.projectId}/deployments/${deployment.id}`}
        className="min-w-0 flex-1 truncate hover:underline"
      >
        {deployment.commitMessage ?? "No commit message"}
      </Link>
      <span className="hidden text-muted-foreground text-xs sm:inline">
        {TRIGGERS[deployment.trigger]}
        {deployment.commitAuthor ? ` · ${deployment.commitAuthor}` : ""}
      </span>
      <span className="w-16 text-right text-muted-foreground text-xs">
        {timeAgo(deployment.createdAt)}
      </span>
      <span className="hidden w-14 text-right font-mono text-muted-foreground text-xs md:inline">
        {took(deployment)}
      </span>
      {menu}
    </li>
  );
}
