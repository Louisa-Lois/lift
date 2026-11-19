"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { type CreatedApiToken, CreateTokenBody, type TokenScope } from "@lift/shared";
import { type ReactNode, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { CopyButton } from "@/components/copy-button";
import { FormField, fieldAria } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formMessages } from "@/lib/form-errors";
import { useCreateToken } from "@/lib/hooks/use-tokens";
import { showProblem } from "@/lib/problems";

/** The scopes as the form explains them. Each one includes the ones before it. */
export const SCOPE_CHOICES: { value: TokenScope; label: string; description: string }[] = [
  { value: "read", label: "Read", description: "See projects, services, deployments and logs." },
  {
    value: "deploy",
    label: "Deploy",
    description: "Also deploy, roll back, cancel and restart. What the lift CLI needs.",
  },
  {
    value: "admin",
    label: "Admin",
    description: "Everything you can do in the dashboard, including variables and tokens.",
  },
];

/**
 * "New token" (docs/prd/02-frontend.md, /account/tokens): a name and a scope, then the token,
 * shown once. Its plaintext lives only in this dialog's state; closing the dialog drops it.
 */
export function NewTokenDialog({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<CreatedApiToken | null>(null);
  const createToken = useCreateToken();
  const form = useForm<CreateTokenBody>({
    resolver: zodResolver(CreateTokenBody, formMessages),
    defaultValues: { name: "", scopes: ["deploy"] },
  });
  const nameError = form.formState.errors.name?.message;

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) {
      setCreated(null);
      form.reset();
    }
  }

  const submit = form.handleSubmit(async (body) => {
    try {
      const token = await createToken.mutateAsync(body);
      setCreated(token);
      // The mutation would otherwise keep the answer, plaintext and all.
      createToken.reset();
    } catch (problem) {
      showProblem(problem, (field, message) => {
        if (field !== "name") return false;
        form.setError("name", { type: "server", message }, { shouldFocus: true });
        return true;
      });
    }
  });

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        showCloseButton={created === null}
        // While the token is on screen only Done closes the dialog, so a stray click can't lose it.
        onInteractOutside={(event) => {
          if (created) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (created) event.preventDefault();
        }}
      >
        {created ? (
          <CreatedToken token={created.token} onDone={() => changeOpen(false)} />
        ) : (
          <form
            // React bubbles events through portals; keep this submit out of any outer form.
            onSubmit={(event) => {
              event.stopPropagation();
              void submit(event);
            }}
            noValidate
            className="grid gap-4"
          >
            <DialogHeader>
              <DialogTitle>New token</DialogTitle>
              <DialogDescription>
                For the lift CLI, the MCP server or a script. It acts as you, within its scope.
              </DialogDescription>
            </DialogHeader>
            <FormField
              id="token-name"
              label="Name"
              error={nameError}
              hint="Where you'll use it, like laptop or ci."
            >
              <Input
                id="token-name"
                autoComplete="off"
                placeholder="laptop"
                {...fieldAria("token-name", nameError, true)}
                {...form.register("name")}
              />
            </FormField>
            <fieldset className="grid gap-2">
              <legend className="mb-2 font-medium text-sm">Scope</legend>
              <Controller
                control={form.control}
                name="scopes"
                render={({ field }) => (
                  <RadioGroup
                    value={field.value[0]}
                    onValueChange={(value) => field.onChange([value])}
                    className="grid gap-2"
                  >
                    {SCOPE_CHOICES.map((choice) => (
                      <Label
                        key={choice.value}
                        htmlFor={`token-scope-${choice.value}`}
                        className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-[[data-state=checked]]:border-primary"
                      >
                        <RadioGroupItem
                          id={`token-scope-${choice.value}`}
                          value={choice.value}
                          className="mt-0.5"
                        />
                        <span className="grid gap-1">
                          <span className="font-medium">{choice.label}</span>
                          <span className="text-muted-foreground text-xs">
                            {choice.description}
                          </span>
                        </span>
                      </Label>
                    ))}
                  </RadioGroup>
                )}
              />
            </fieldset>
            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Creating…" : "Create token"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreatedToken({ token, onDone }: { token: string; onDone: () => void }) {
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Copy your new token</DialogTitle>
        <DialogDescription>Copy it now. Lift shows it only once.</DialogDescription>
      </DialogHeader>
      <div className="flex items-center gap-2">
        <Input
          readOnly
          value={token}
          aria-label="Your new token"
          className="font-mono text-xs"
          onFocus={(event) => event.currentTarget.select()}
        />
        <CopyButton value={token} label="Copy the token" />
      </div>
      <p className="text-muted-foreground text-xs">
        Sign the CLI in with <code className="font-mono">lift login --token</code> and this token.
      </p>
      <DialogFooter>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </div>
  );
}
