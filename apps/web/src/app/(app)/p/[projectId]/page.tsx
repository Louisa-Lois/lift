import type { Metadata } from "next";
import { ProjectOverview } from "@/components/project-overview";

export const metadata: Metadata = { title: "Project · Lift" };

export default async function ProjectPage({ params }: PageProps<"/p/[projectId]">) {
  const { projectId } = await params;
  return <ProjectOverview projectId={projectId} />;
}
