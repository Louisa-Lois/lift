"use client";

import { isLiftApiError } from "@lift/shared";
import { Loader2Icon, LockIcon, SlidersHorizontalIcon, SparklesIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { NewServiceForm } from "@/components/new-service-form";
import { type PickedRepo, RepoPicker } from "@/components/repo-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCreatePlan } from "@/lib/hooks/use-plans";

/**
 * /new (FE-04): pick a repo, then choose how to configure it. "Continue with AI" (FE-14) asks the
 * assistant for a plan, which takes up to a minute, then opens its review. `?project=`
 * preselects the project, and the review adds the service there.
 */
export function NewServiceFlow() {
  const router = useRouter();
  const projectId = useSearchParams().get("project");
  const [repo, setRepo] = useState<PickedRepo | null>(null);
  const [manual, setManual] = useState(false);
  const createPlan = useCreatePlan();

  function planWithAi(picked: PickedRepo) {
    createPlan.mutate(
      {
        owner: picked.owner,
        repo: picked.name,
        ...(picked.defaultBranch ? { branch: picked.defaultBranch } : {}),
      },
      {
        onSuccess: (plan) =>
          router.push(
            `/new/plan/${plan.id}${projectId ? `?project=${encodeURIComponent(projectId)}` : ""}`,
          ),
      },
    );
  }

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
            <Button
              variant="ghost"
              size="sm"
              disabled={createPlan.isPending}
              onClick={() => {
                createPlan.reset();
                setRepo(null);
              }}
            >
              Change repo
            </Button>
          </div>
          {manual ? (
            <NewServiceForm
              repo={repo}
              defaultProjectId={projectId}
              onCreated={(service) =>
                router.push(
                  service.latestDeployment
                    ? `/p/${service.projectId}/deployments/${service.latestDeployment.id}`
                    : `/p/${service.projectId}`,
                )
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-3 rounded-lg border p-4">
                <div className="flex items-center gap-2 font-medium">
                  <SparklesIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  Continue with AI
                </div>
                <p className="text-muted-foreground text-xs">
                  The assistant reads the repo and plans its service, database and variables for you
                  to review.
                </p>
                {createPlan.isPending ? (
                  <p role="status" className="text-muted-foreground text-xs">
                    Reading {repo.owner}/{repo.name}… this takes up to 30 seconds.
                  </p>
                ) : createPlan.isError ? (
                  <p role="alert" className="text-destructive text-xs">
                    {isLiftApiError(createPlan.error)
                      ? createPlan.error.detail
                      : "The assistant couldn't be reached. Check your connection and try again."}{" "}
                    You can still configure it manually.
                  </p>
                ) : null}
                <Button
                  variant="secondary"
                  className="mt-auto w-fit"
                  disabled={createPlan.isPending}
                  onClick={() => planWithAi(repo)}
                >
                  {createPlan.isPending ? (
                    <Loader2Icon className="animate-spin" aria-hidden="true" />
                  ) : null}
                  {createPlan.isError ? "Try again" : "Continue with AI"}
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
                <Button
                  className="mt-auto w-fit"
                  disabled={createPlan.isPending}
                  onClick={() => setManual(true)}
                >
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
