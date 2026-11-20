"use client";

import { type EditorChange, isLiftApiError } from "@lift/shared";
import { RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fileName } from "@/lib/editor-files";
import { useCommitChanges, useDiscardChanges } from "@/lib/hooks/use-editor";
import { showProblem } from "@/lib/problems";

const defaultMessage = (paths: string[]) =>
  paths.length === 1 ? `Update ${fileName(paths[0] ?? "")}` : `Update ${paths.length} files`;

/**
 * Commit & deploy (FE-13, docs/prd/02-frontend.md): a message prefilled with "Update {file}", the
 * changed files to include, and the commit. Success says so with a link to the new deployment.
 * When files changed on GitHub meanwhile, it lists them, with "Discard and reload".
 */
export function CommitDialog({
  projectId,
  serviceId,
  changes,
  open,
  onOpenChange,
}: {
  projectId: string;
  serviceId: string;
  changes: EditorChange[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const commit = useCommitChanges(serviceId);
  const discard = useDiscardChanges(serviceId);
  const paths = changes.map((change) => change.path);
  const [message, setMessage] = useState(() => defaultMessage(paths));
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(paths));
  const [conflicts, setConflicts] = useState<Record<string, string> | null>(null);
  const messageId = useId();
  const included = paths.filter((path) => chosen.has(path));

  function toggle(path: string) {
    setChosen((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const result = await commit.mutateAsync({
        message,
        ...(included.length < paths.length ? { paths: included } : {}),
      });
      toast.success(`Committed ${result.commitSha.slice(0, 7)}`, {
        description: "Lift is deploying it now.",
        action: {
          label: "Open deployment",
          onClick: () => router.push(`/p/${projectId}/deployments/${result.deploymentId}`),
        },
      });
      onOpenChange(false);
    } catch (error) {
      if (isLiftApiError(error) && error.status === 409 && error.fields) {
        setConflicts(error.fields);
        return;
      }
      showProblem(error);
    }
  }

  async function reload() {
    const stale = Object.keys(conflicts ?? {});
    try {
      await discard.mutateAsync(stale);
      toast.success(
        stale.length === 1
          ? `Reloaded ${fileName(stale[0] ?? "")} from GitHub`
          : `Reloaded ${stale.length} files from GitHub`,
      );
      onOpenChange(false);
    } catch (error) {
      showProblem(error);
    }
  }

  if (conflicts) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>These files changed on GitHub</DialogTitle>
            <DialogDescription>
              Someone pushed to the branch since you opened them, so nothing was committed. Discard
              your changes to them and reload GitHub's version, then make your change again.
            </DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-1.5 text-sm">
            {Object.entries(conflicts).map(([path, why]) => (
              <li key={path} className="flex flex-col">
                <span className="font-mono">{path}</span>
                <span className="text-muted-foreground text-xs">{why}</span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={reload} disabled={discard.isPending}>
              <RefreshCwIcon aria-hidden="true" />
              {discard.isPending ? "Reloading…" : "Discard and reload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Commit & deploy</DialogTitle>
            <DialogDescription>
              Lift commits to the branch as you, then deploys the commit.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={messageId}>Message</Label>
            <Input
              id={messageId}
              value={message}
              maxLength={500}
              onChange={(event) => setMessage(event.target.value)}
            />
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 font-medium text-sm">Files</legend>
            {paths.map((path) => (
              <label key={path} className="flex items-center gap-2 font-mono text-sm">
                <input type="checkbox" checked={chosen.has(path)} onChange={() => toggle(path)} />
                {path}
              </label>
            ))}
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={commit.isPending || included.length === 0 || message.trim() === ""}
            >
              {commit.isPending ? "Committing…" : "Commit & deploy"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
