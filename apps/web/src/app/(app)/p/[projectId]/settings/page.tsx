import type { Metadata } from "next";
import { ProjectSettings } from "@/components/project-settings";

export const metadata: Metadata = { title: "Project settings · Lift" };

export default async function ProjectSettingsPage({
  params,
}: PageProps<"/p/[projectId]/settings">) {
  const { projectId } = await params;
  return <ProjectSettings projectId={projectId} />;
}
