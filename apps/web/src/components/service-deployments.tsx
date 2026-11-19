"use client";

import type { Service } from "@lift/shared";
import { DeploymentRow } from "@/components/deployment-row";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeployments } from "@/lib/hooks/use-deployments";

/** A service's recent deployments, newest first, kept live by the project stream. */
export function ServiceDeployments({ service }: { service: Service }) {
  const deployments = useDeployments(service.id);
  if (deployments.isPending) {
    return (
      <div role="status" aria-label="Loading deployments" className="px-4 py-3">
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  if ((deployments.data?.data.length ?? 0) === 0) {
    return <p className="px-4 py-3 text-muted-foreground text-xs">No deployments yet.</p>;
  }
  return (
    <ul aria-label={`Deployments of ${service.name}`} className="divide-y">
      {deployments.data?.data.map((deployment) => (
        <DeploymentRow key={deployment.id} deployment={deployment} repo={service.repo} />
      ))}
    </ul>
  );
}
