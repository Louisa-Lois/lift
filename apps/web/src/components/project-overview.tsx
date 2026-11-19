"use client";

import { isLiftApiError } from "@lift/shared";
import { FolderGit2Icon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { DatabasesSection } from "@/components/databases-section";
import { EmptyState } from "@/components/empty-state";
import { ServicePanel } from "@/components/service-panel";
import { ServiceRow } from "@/components/service-row";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectEvents } from "@/lib/hooks/use-project-events";
import { useProject } from "@/lib/hooks/use-projects";

/**
 * /p/[projectId] until FE-06 brings the canvas: the project's services with their recent
 * deployments, kept live by the project's event stream, and the way to deploy one from GitHub.
 */
export function ProjectOverview({ projectId }: { projectId: string }) {
  useProjectEvents(projectId);
  const project = useProject(projectId);

  if (project.isPending) {
    return (
      <div role="status" aria-label="Loading project" className="flex flex-col gap-6">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-40 rounded-lg" />
      </div>
    );
  }
  if (project.isError) {
    const missing = isLiftApiError(project.error) && project.error.status === 404;
    return (
      <EmptyState
        title={missing ? "Project not found" : "Couldn't load this project"}
        description={
          missing
            ? "It doesn't exist, or you aren't a member of it."
            : "Check your connection and try again."
        }
        action={
          missing ? (
            <Button asChild variant="outline">
              <Link href="/projects">Back to projects</Link>
            </Button>
          ) : (
            <Button variant="outline" onClick={() => void project.refetch()}>
              Try again
            </Button>
          )
        }
      />
    );
  }

  const { name, role, services, databases } = project.data;
  const canDeploy = role !== "viewer";
  const newService = `/new?project=${encodeURIComponent(projectId)}`;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            href="/projects"
            className="w-fit text-muted-foreground text-xs hover:text-foreground"
          >
            Projects
          </Link>
          <h1 className="truncate font-heading font-semibold text-xl">{name}</h1>
        </div>
        {canDeploy && services.length > 0 ? (
          <Button asChild>
            <Link href={newService}>
              <PlusIcon aria-hidden="true" />
              New service
            </Link>
          </Button>
        ) : null}
      </div>
      {services.length === 0 ? (
        <EmptyState
          icon={<FolderGit2Icon className="size-8" />}
          title={canDeploy ? "Deploy from GitHub" : "No services yet"}
          description={
            canDeploy
              ? "Pick a repo. Lift builds it and runs it at its own address."
              : "An editor or the owner can deploy the first service."
          }
          action={
            canDeploy ? (
              <Button asChild size="lg">
                <Link href={newService}>Deploy from GitHub</Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <section aria-labelledby="services-heading" className="flex flex-col gap-3">
          <h2 id="services-heading" className="font-medium text-muted-foreground text-sm">
            Services
          </h2>
          <ul className="flex flex-col gap-4">
            {services.map((service) => (
              <ServiceRow key={service.id} service={service} canDeploy={canDeploy} />
            ))}
          </ul>
        </section>
      )}
      {services.length > 0 || databases.length > 0 ? (
        <DatabasesSection projectId={projectId} databases={databases} canEdit={canDeploy} />
      ) : null}
      {/* useSearchParams needs a Suspense boundary in the App Router. */}
      <Suspense fallback={null}>
        <ServicePanel services={services} canEdit={canDeploy} />
      </Suspense>
    </div>
  );
}
