import { FolderGit2Icon } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Projects · Lift" };

// FE-03 replaces this with the projects grid and "New project".
export default function ProjectsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading font-semibold text-xl">Projects</h1>
      <EmptyState
        icon={<FolderGit2Icon className="size-8" />}
        title="No projects yet"
        description="Projects you create or join will appear here."
      />
    </div>
  );
}
