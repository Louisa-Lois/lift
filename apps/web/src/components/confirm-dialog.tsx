"use client";

import { type MouseEvent, type ReactNode, useId, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ConfirmDialogProps {
  /** Opens the dialog. Leave it out to control `open` yourself. */
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  /** What happens if you go ahead, in plain words. */
  description: ReactNode;
  confirmLabel: string;
  /** Shown on the button while `onConfirm` runs, like "Revoking…". */
  pendingLabel?: string;
  /** For actions that delete something or can't be undone. */
  destructive?: boolean;
  /** A name to type before the button works, for deletes that lose data. */
  confirmPhrase?: string;
  /**
   * The action. The dialog stays open with its buttons disabled until it settles, and closes when
   * it succeeds. If it throws, the dialog stays open: show the error from inside it.
   */
  onConfirm: () => Promise<unknown>;
}

/** "Are you sure?" before rollback, cancel, restart, revoke and delete (PRD 02, FE-10). */
export function ConfirmDialog({
  trigger,
  open: controlledOpen,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  destructive = false,
  confirmPhrase,
  onConfirm,
}: ConfirmDialogProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const phraseId = useId();
  const open = controlledOpen ?? ownOpen;
  const ready = confirmPhrase === undefined || typed.trim() === confirmPhrase;

  function setOpen(next: boolean) {
    if (pending) return;
    if (controlledOpen === undefined) setOwnOpen(next);
    onOpenChange?.(next);
    if (!next) setTyped("");
  }

  async function confirm(event: MouseEvent) {
    // The action button would close the dialog at once; it closes when the action succeeds.
    event.preventDefault();
    if (!ready || pending) return;
    setPending(true);
    try {
      await onConfirm();
      setPending(false);
      if (controlledOpen === undefined) setOwnOpen(false);
      onOpenChange?.(false);
      setTyped("");
    } catch {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="grid gap-2">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {confirmPhrase === undefined ? null : (
          <div className="grid gap-2">
            <Label htmlFor={phraseId} className="font-normal">
              Type <span className="font-medium font-mono">{confirmPhrase}</span> to confirm
            </Label>
            <Input
              id={phraseId}
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={!ready || pending}
            onClick={confirm}
          >
            {pending ? (pendingLabel ?? `${confirmLabel}…`) : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
