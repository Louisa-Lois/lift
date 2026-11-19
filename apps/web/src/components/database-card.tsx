"use client";

import type { Database, DatabaseStatus } from "@lift/shared";
import { DatabaseIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DatabaseCredentialsDialog } from "@/components/database-credentials-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDeleteDatabase } from "@/lib/hooks/use-databases";
import { showProblem } from "@/lib/problems";
import { cn } from "@/lib/utils";

/** Each database status with the theme's status colours, like deployments'. */
const STATUS: Record<DatabaseStatus, { label: string; dot: string; pulse: boolean }> = {
  provisioning: { label: "Provisioning", dot: "bg-status-building", pulse: true },
  ready: { label: "Ready", dot: "bg-status-active", pulse: false },
  failed: { label: "Failed", dot: "bg-status-failed", pulse: false },
  deleting: { label: "Deleting", dot: "bg-status-canceled", pulse: true },
};

/** A database on the project page (FE-08): name, status, what it gives the services. */
export function DatabaseCard({ database, canEdit }: { database: Database; canEdit: boolean }) {
  const remove = useDeleteDatabase(database.projectId);
  const status = STATUS[database.status];

  async function deleteIt() {
    try {
      await remove.mutateAsync(database.id);
      toast.success(`Deleting ${database.name}`);
    } catch (error) {
      showProblem(error);
      throw error;
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <DatabaseIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{database.name}</span>
            <Badge variant="outline" data-status={database.status} className="gap-1.5 font-normal">
              <span
                aria-hidden="true"
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  status.dot,
                  status.pulse && "animate-pulse",
                )}
              />
              {status.label}
            </Badge>
          </div>
          <span className="text-muted-foreground text-xs">
            Postgres ·{" "}
            {database.status === "ready"
              ? `Sets ${database.envVar} on this project's services`
              : database.status === "failed"
                ? "Lift couldn't create it. Delete it and add another."
                : `${database.envVar} reaches the services once it's ready`}
          </span>
        </div>
      </div>
      {canEdit ? (
        <div className="flex items-center gap-2">
          {database.status === "ready" ? <DatabaseCredentialsDialog database={database} /> : null}
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="sm" aria-label={`Delete ${database.name}`}>
                <Trash2Icon aria-hidden="true" />
                Delete
              </Button>
            }
            title={`Delete ${database.name}?`}
            description={
              <>
                <p>Its data is deleted for good: Lift doesn't back up users' databases.</p>
                <p>
                  Apps connected to it lose it at once, and {database.envVar} leaves every service's
                  variables.
                </p>
              </>
            }
            confirmLabel="Delete database"
            pendingLabel="Deleting…"
            destructive
            confirmPhrase={database.name}
            onConfirm={deleteIt}
          />
        </div>
      ) : null}
    </li>
  );
}
