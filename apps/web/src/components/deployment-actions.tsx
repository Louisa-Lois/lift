"use client";

import type { Deployment, RollbackCheck } from "@lift/shared";
import {
  CopyIcon,
  EllipsisIcon,
  RotateCcwIcon,
  RotateCwIcon,
  ScrollTextIcon,
  SquareIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useCancelDeployment,
  useRedeploy,
  useRestartService,
  useRollback,
} from "@/lib/hooks/use-deployment-actions";
import { showProblem } from "@/lib/problems";

const short = (deployment: Pick<Deployment, "commitSha">) => deployment.commitSha.slice(0, 7);

/** Runs an action, showing its problem as a toast; rethrows so a dialog stays open on failure. */
async function attempt<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    showProblem(error);
    throw error;
  }
}

/**
 * "Roll back {service} to {sha}?" (FE-10): what a rollback does, said before it does it. It runs
 * the old image with today's variables and settings (PRD 01), and a running build still lands.
 */
export function RollbackDialog({
  deployment,
  serviceName,
  buildInProgress,
  open,
  onOpenChange,
  trigger,
}: {
  deployment: Deployment;
  serviceName: string;
  buildInProgress: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
}) {
  const rollback = useRollback();
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      title={`Roll back ${serviceName} to ${short(deployment)}?`}
      description={
        <>
          <p>
            Lift runs that deployment's image again with today's variables and settings, not the
            ones it had then. No build runs.
          </p>
          {buildInProgress ? (
            <p>
              The build in progress will still go live when it finishes. Cancel it first if you
              don't want that.
            </p>
          ) : null}
        </>
      }
      confirmLabel="Roll back"
      pendingLabel="Rolling back…"
      onConfirm={async () => {
        const created = await attempt(() => rollback.mutateAsync(deployment.id));
        router.push(`/p/${created.projectId}/deployments/${created.id}`);
      }}
    />
  );
}

/** "Cancel" on a queued or building deployment. */
export function CancelDeploymentButton({ deployment }: { deployment: Deployment }) {
  const cancel = useCancelDeployment();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline">
          <SquareIcon aria-hidden="true" />
          Cancel
        </Button>
      }
      title="Cancel this deployment?"
      description={<p>The build stops, and what's live now keeps running.</p>}
      confirmLabel="Cancel deployment"
      dismissLabel="Keep it"
      pendingLabel="Canceling…"
      destructive
      onConfirm={() => attempt(() => cancel.mutateAsync(deployment.id))}
    />
  );
}

/** "Redeploy": builds the same commit again. */
export function RedeployButton({ deployment }: { deployment: Deployment }) {
  const redeploy = useRedeploy();
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline">
          <RotateCwIcon aria-hidden="true" />
          Redeploy
        </Button>
      }
      title={`Redeploy ${short(deployment)}?`}
      description={
        <p>Lift builds this commit again and deploys it with today's variables and settings.</p>
      }
      confirmLabel="Redeploy"
      pendingLabel="Starting…"
      onConfirm={async () => {
        const created = await attempt(() => redeploy.mutateAsync(deployment));
        router.push(`/p/${created.projectId}/deployments/${created.id}`);
      }}
    />
  );
}

/** "Restart" on a live service: same image and variables, a few seconds down. */
export function RestartServiceButton({
  serviceId,
  serviceName,
  size = "sm",
}: {
  serviceId: string;
  serviceName: string;
  size?: "sm" | "default";
}) {
  const restart = useRestartService();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size={size}>
          <RotateCcwIcon aria-hidden="true" />
          Restart
        </Button>
      }
      title={`Restart ${serviceName}?`}
      description={
        <p>
          Its container restarts with the same image and variables, and it's down for a few seconds.
          Variable changes need a deploy.
        </p>
      }
      confirmLabel="Restart"
      pendingLabel="Restarting…"
      onConfirm={async () => {
        await attempt(() => restart.mutateAsync(serviceId));
        toast.success(`Restarting ${serviceName}`);
      }}
    />
  );
}

/**
 * A deployment row's menu (PRD 02, "Deployments list"): View logs · Rollback to this · Copy ID.
 * Rollback is offered only where the shared rule allows it, and says why not otherwise.
 */
export function DeploymentMenu({
  deployment,
  serviceName,
  rollback,
  buildInProgress,
  canEdit,
}: {
  deployment: Deployment;
  serviceName: string;
  rollback: RollbackCheck;
  buildInProgress: boolean;
  canEdit: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`More for deployment ${short(deployment)}`}
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuItem asChild>
            <Link href={`/p/${deployment.projectId}/deployments/${deployment.id}`}>
              <ScrollTextIcon />
              View logs
            </Link>
          </DropdownMenuItem>
          {canEdit ? (
            <DropdownMenuItem disabled={!rollback.ok} onSelect={() => setConfirming(true)}>
              <RotateCcwIcon />
              <span className="flex flex-col">
                Rollback to this
                {rollback.ok ? null : (
                  <span className="text-muted-foreground text-xs">{rollback.reason}</span>
                )}
              </span>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              void navigator.clipboard
                .writeText(deployment.id)
                .then(() => toast.success("Copied the deployment ID"))
                .catch(() => toast.error("Couldn't copy to the clipboard"));
            }}
          >
            <CopyIcon />
            Copy ID
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {canEdit && rollback.ok ? (
        <RollbackDialog
          deployment={deployment}
          serviceName={serviceName}
          buildInProgress={buildInProgress}
          open={confirming}
          onOpenChange={setConfirming}
        />
      ) : null}
    </>
  );
}
