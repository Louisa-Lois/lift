"use client";

import type { Service } from "@lift/shared";
import { ExternalLinkIcon, GitBranchIcon, RocketIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { DeploymentRow } from "@/components/deployment-row";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeploy, useDeployments } from "@/lib/hooks/use-deployments";
import { showProblem } from "@/lib/problems";

/** A branch's page on GitHub; a branch name can hold slashes, so encode each part. */
function branchUrl({ owner, name, branch }: Service["repo"]): string {
  const path = branch.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${owner}/${name}/tree/${path}`;
}

/**
 * One service on the project page: name, latest status, repo and branch, its address once live,
 * "Deploy", and its recent deployments. FE-06 replaces this list with the canvas's cards.
 */
export function ServiceRow({ service, canDeploy }: { service: Service; canDeploy: boolean }) {
  const router = useRouter();
  const deploy = useDeploy();
  const deployments = useDeployments(service.id);
  const latest = service.latestDeployment;
  const host = new URL(service.url).host;

  async function deployNow() {
    try {
      const deployment = await deploy.mutateAsync(service.id);
      router.push(`/p/${deployment.projectId}/deployments/${deployment.id}`);
    } catch (error) {
      showProblem(error);
    }
  }

  return (
    <li className="overflow-hidden rounded-lg border">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
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
        {service.activeDeploymentId ? (
          <a
            href={service.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 font-mono text-foreground text-xs hover:underline"
          >
            {host}
            <ExternalLinkIcon className="size-3" aria-hidden="true" />
          </a>
        ) : (
          <span
            className="font-mono text-muted-foreground text-xs"
            title="Live after the first deploy"
          >
            {host}
          </span>
        )}
        {canDeploy ? (
          <Button variant="outline" size="sm" onClick={deployNow} disabled={deploy.isPending}>
            <RocketIcon aria-hidden="true" />
            {deploy.isPending ? "Deploying…" : "Deploy"}
          </Button>
        ) : null}
      </div>
      <div className="border-t bg-muted/20">
        {deployments.isPending ? (
          <div role="status" aria-label="Loading deployments" className="px-4 py-3">
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (deployments.data?.data.length ?? 0) === 0 ? (
          <p className="px-4 py-3 text-muted-foreground text-xs">No deployments yet.</p>
        ) : (
          <ul aria-label={`Deployments of ${service.name}`} className="divide-y">
            {deployments.data?.data.map((deployment) => (
              <DeploymentRow key={deployment.id} deployment={deployment} repo={service.repo} />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}
