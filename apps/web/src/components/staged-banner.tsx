"use client";

import { RocketIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * "3 changes staged. Deploy to apply." (docs/prd/02-frontend.md, "Variables tab"): saved
 * variables reach the app only with its next deployment, as on Railway.
 */
export function StagedBanner({
  count,
  canDeploy,
  deploying,
  onDeploy,
}: {
  count: number;
  canDeploy: boolean;
  deploying: boolean;
  onDeploy: () => void;
}) {
  return (
    <div
      role="status"
      className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2.5"
    >
      <p className="text-sm">
        {count} {count === 1 ? "change" : "changes"} staged. Deploy to apply.
      </p>
      {canDeploy ? (
        <Button size="sm" onClick={onDeploy} disabled={deploying}>
          <RocketIcon aria-hidden="true" />
          {deploying ? "Deploying…" : "Deploy"}
        </Button>
      ) : null}
    </div>
  );
}
