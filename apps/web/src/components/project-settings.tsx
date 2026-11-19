"use client";

import { isLiftApiError } from "@lift/shared";
import Link from "next/link";
import { MembersSection } from "@/components/members-section";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectEvents } from "@/lib/hooks/use-project-events";
import { useProject } from "@/lib/hooks/use-projects";

/** `/p/[projectId]/settings` (FE-11): members for now; renaming and deleting come with polish. */
export function ProjectSettings({ projectId }: { projectId: string }) {
  useProjectEvents(projectId);
  const project = useProject(projectId);
  if (project.isPending) return <Skeleton className="h-40 w-full max-w-3xl" />;
  if (project.isError) {
    return (
      <p className="text-muted-foreground">
        {isLiftApiError(project.error) && project.error.status === 404
          ? "This project doesn't exist, or you aren't a member."
          : "Lift couldn't load this project."}
      </p>
    );
  }
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/p/${projectId}`}
          className="w-fit text-muted-foreground text-xs hover:text-foreground"
        >
          {project.data.name}
        </Link>
        <h1 className="font-heading font-semibold text-xl">Settings</h1>
      </div>
      <MembersSection projectId={projectId} isOwner={project.data.role === "owner"} />
    </div>
  );
}
