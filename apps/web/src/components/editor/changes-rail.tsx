"use client";

import type { EditorChange } from "@lift/shared";
import { Undo2Icon } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { fileName } from "@/lib/editor-files";
import { useDiscardChanges } from "@/lib/hooks/use-editor";
import { showProblem } from "@/lib/problems";
import { cn } from "@/lib/utils";

/**
 * The right rail (FE-13): the files with changes nobody has committed. A file opens in a tab;
 * editors can discard one, which reloads it from GitHub for everyone editing it.
 */
export function ChangesRail({
  serviceId,
  changes,
  active,
  canEdit,
  onOpen,
}: {
  serviceId: string;
  changes: EditorChange[];
  active: string | null;
  canEdit: boolean;
  onOpen: (path: string) => void;
}) {
  const discard = useDiscardChanges(serviceId);
  return (
    <aside aria-label="Changes" className="flex w-64 shrink-0 flex-col border-l">
      <h2 className="border-b px-3 py-2 font-medium text-sm">Changes ({changes.length})</h2>
      {changes.length === 0 ? (
        <p className="p-3 text-muted-foreground text-xs">
          Nothing to commit. Edits show here as you type.
        </p>
      ) : (
        <ul className="overflow-y-auto py-1">
          {changes.map((change) => (
            <li
              key={change.path}
              className={cn(
                "group flex items-center gap-1 pr-1 hover:bg-muted",
                active === change.path && "bg-muted",
              )}
            >
              <button
                type="button"
                title={change.path}
                onClick={() => onOpen(change.path)}
                className="flex min-w-0 flex-1 flex-col px-3 py-1.5 text-left"
              >
                <span className="truncate font-mono text-xs">{fileName(change.path)}</span>
                {change.path.includes("/") ? (
                  <span className="truncate text-muted-foreground text-xs">
                    {change.path.slice(0, change.path.lastIndexOf("/"))}
                  </span>
                ) : null}
              </button>
              {canEdit ? (
                <ConfirmDialog
                  trigger={
                    <Button variant="ghost" size="icon-sm" aria-label={`Discard ${change.path}`}>
                      <Undo2Icon aria-hidden="true" />
                    </Button>
                  }
                  title={`Discard the changes to ${fileName(change.path)}?`}
                  description="The file reloads from GitHub for everyone editing it. This can't be undone."
                  confirmLabel="Discard"
                  pendingLabel="Discarding…"
                  destructive
                  onConfirm={async () => {
                    try {
                      await discard.mutateAsync([change.path]);
                      toast.success(`Reloaded ${fileName(change.path)} from GitHub`);
                    } catch (error) {
                      showProblem(error);
                      throw error;
                    }
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
