"use client";

import { LockIcon, SlidersHorizontalIcon, SparklesIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { NewServiceForm } from "@/components/new-service-form";
import { type PickedRepo, RepoPicker } from "@/components/repo-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * /new (FE-04): pick a repo, then choose how to configure it. "Continue with AI" opens the plan
 * review once the agent's plans arrive (Nov 24); until then only "Configure manually" works.
 * `?project=` preselects the project.
 */
export function NewServiceFlow() {
  const router = useRouter();
  const projectId = useSearchParams().get("project");
  const [repo, setRepo] = useState<PickedRepo | null>(null);
  const [manual, setManual] = useState(false);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading font-semibold text-xl">Deploy from GitHub</h1>
        <p className="text-muted-foreground">
          {repo === null
            ? "Pick the repo to deploy."
            : manual
              ? "Check the settings, then create the service. Lift deploys it right away."
              : "How should Lift set it up?"}
        </p>
      </div>
      {repo === null ? (
        <RepoPicker
          onPick={(picked) => {
            setRepo(picked);
            setManual(false);
          }}
        />
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-lg border px-4 py-3">
            <span className="min-w-0 flex-1 truncate">
              <span className="text-muted-foreground">{repo.owner}/</span>
              <span className="font-medium">{repo.name}</span>
            </span>
            {repo.private ? (
              <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                <LockIcon aria-hidden="true" />
                Private
              </Badge>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => setRepo(null)}>
              Change repo
            </Button>
          </div>
          {manual ? (
            <NewServiceForm
              repo={repo}
              defaultProjectId={projectId}
              onCreated={(service) => router.push(`/p/${service.projectId}`)}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-3 rounded-lg border p-4">
                <div className="flex items-center gap-2 font-medium">
                  <SparklesIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  Continue with AI
                  <Badge variant="outline" className="font-normal text-muted-foreground">
                    Coming soon
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs">
                  The assistant reads the repo and plans its services, databases and variables for
                  you to review.
                </p>
                <Button variant="secondary" disabled className="mt-auto w-fit">
                  Continue with AI
                </Button>
              </div>
              <div className="flex flex-col gap-3 rounded-lg border p-4">
                <div className="flex items-center gap-2 font-medium">
                  <SlidersHorizontalIcon
                    className="size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  Configure manually
                </div>
                <p className="text-muted-foreground text-xs">
                  Choose the project, branch, folder and port yourself.
                </p>
                <Button className="mt-auto w-fit" onClick={() => setManual(true)}>
                  Configure manually
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
