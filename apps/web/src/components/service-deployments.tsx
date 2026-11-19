"use client";

import { rollbackTarget, type Service } from "@lift/shared";
import { DeploymentMenu } from "@/components/deployment-actions";
import { DeploymentRow } from "@/components/deployment-row";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeployments } from "@/lib/hooks/use-deployments";

/**
 * A service's recent deployments, newest first, kept live by the project stream, each with its
 * menu. Whether a row offers rollback comes from the shared rule (`rollbackTarget`), the same one
 * the API checks.
 */
export function ServiceDeployments({ service, canEdit }: { service: Service; canEdit: boolean }) {
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
  const list = deployments.data?.data ?? [];
  const buildInProgress = list.some(
    (deployment) => deployment.status === "queued" || deployment.status === "building",
  );
  return (
    <ul aria-label={`Deployments of ${service.name}`} className="divide-y">
      {list.map((deployment) => (
        <DeploymentRow
          key={deployment.id}
          deployment={deployment}
          repo={service.repo}
          menu={
            <DeploymentMenu
              deployment={deployment}
              serviceName={service.name}
              rollback={rollbackTarget(deployment, list)}
              buildInProgress={buildInProgress}
              canEdit={canEdit}
            />
          }
        />
      ))}
    </ul>
  );
}
