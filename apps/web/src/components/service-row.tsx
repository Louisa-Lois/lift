import type { Service } from "@lift/shared";
import { ExternalLinkIcon, GitBranchIcon } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/format";

/** A branch's page on GitHub; a branch name can hold slashes, so encode each part. */
function branchUrl({ owner, name, branch }: Service["repo"]): string {
  const path = branch.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${owner}/${name}/tree/${path}`;
}

/**
 * One service on the project page: name, latest deployment status, repo and branch, and its
 * address once a deployment is live. FE-06 replaces this list with the canvas's service cards.
 */
export function ServiceRow({ service }: { service: Service }) {
  const latest = service.latestDeployment;
  const host = new URL(service.url).host;
  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{service.name}</span>
          {latest ? (
            <StatusBadge status={latest.status} />
          ) : (
            <Badge variant="outline" className="font-normal text-muted-foreground">
              Not deployed
            </Badge>
          )}
        </div>
        <a
          href={branchUrl(service.repo)}
          target="_blank"
          rel="noreferrer"
          className="flex w-fit max-w-full items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
        >
          <GitBranchIcon className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {service.repo.owner}/{service.repo.name} · {service.repo.branch}
          </span>
        </a>
      </div>
      <div className="flex flex-col items-end gap-1 text-xs">
        {service.activeDeploymentId ? (
          <a
            href={service.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 font-mono text-foreground hover:underline"
          >
            {host}
            <ExternalLinkIcon className="size-3" aria-hidden="true" />
          </a>
        ) : (
          <span className="font-mono text-muted-foreground" title="Live after the first deploy">
            {host}
          </span>
        )}
        {latest ? <span className="text-muted-foreground">{timeAgo(latest.createdAt)}</span> : null}
      </div>
    </li>
  );
}
