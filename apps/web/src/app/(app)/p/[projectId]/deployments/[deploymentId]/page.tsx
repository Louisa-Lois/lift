import type { Metadata } from "next";
import { DeploymentView } from "@/components/deployment-view";

export const metadata: Metadata = { title: "Deployment · Lift" };

export default async function DeploymentPage({
  params,
}: PageProps<"/p/[projectId]/deployments/[deploymentId]">) {
  const { projectId, deploymentId } = await params;
  return <DeploymentView projectId={projectId} deploymentId={deploymentId} />;
}
