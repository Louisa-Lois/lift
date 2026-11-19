"use client";

import { FolderGit2Icon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { NewProjectDialog } from "@/components/new-project-dialog";
import { ProjectCard } from "@/components/project-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjects } from "@/lib/hooks/use-projects";

/** /projects (FE-03): a card per project, and "New project", which opens the new project. */
export function ProjectsGrid() {
  const router = useRouter();
  const projects = useProjects();
  const newProject = (
    <NewProjectDialog
      trigger={
        <Button>
          <PlusIcon aria-hidden="true" />
          New project
        </Button>
      }
      onCreated={(project) => router.push(`/p/${project.id}`)}
    />
  );
  const list = projects.data?.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading font-semibold text-xl">Projects</h1>
        {list.length > 0 ? newProject : null}
      </div>
      {projects.isPending ? (
        <div
          role="status"
          aria-label="Loading projects"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {[0, 1, 2].map((card) => (
            <Skeleton key={card} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : projects.isError ? (
        <EmptyState
          title="Couldn't load your projects"
          description="Check your connection and try again."
          action={
            <Button variant="outline" onClick={() => void projects.refetch()}>
              Try again
            </Button>
          }
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<FolderGit2Icon className="size-8" />}
          title="No projects yet"
          description="Create a project, then deploy a service into it from a GitHub repo."
          action={newProject}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
