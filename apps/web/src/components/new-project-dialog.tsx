"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CreateProjectBody, type ProjectDetail } from "@lift/shared";
import { type ReactNode, useState } from "react";
import { useForm } from "react-hook-form";
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
import { formMessages } from "@/lib/form-errors";
import { useCreateProject } from "@/lib/hooks/use-projects";
import { showProblem } from "@/lib/problems";

/** "New project": a name, then `onCreated` with the new project (usually to open it). */
export function NewProjectDialog({
  trigger,
  onCreated,
}: {
  trigger: ReactNode;
  onCreated: (project: ProjectDetail) => void;
}) {
  const [open, setOpen] = useState(false);
  const createProject = useCreateProject();
  const form = useForm<CreateProjectBody>({
    resolver: zodResolver(CreateProjectBody, formMessages),
    defaultValues: { name: "" },
  });
  const error = form.formState.errors.name?.message;

  const submit = form.handleSubmit(async ({ name }) => {
    try {
      const project = await createProject.mutateAsync(name);
      setOpen(false);
      form.reset();
      onCreated(project);
    } catch (problem) {
      showProblem(problem, (field, message) => {
        if (field !== "name") return false;
        form.setError("name", { type: "server", message }, { shouldFocus: true });
        return true;
      });
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form
          // React bubbles events through portals: without this, submitting here would also
          // submit a form the dialog is opened from, such as the new-service form.
          onSubmit={(event) => {
            event.stopPropagation();
            void submit(event);
          }}
          noValidate
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              A project holds the services and databases of one app.
            </DialogDescription>
          </DialogHeader>
          <FormField id="project-name" label="Name" error={error}>
            <Input
              id="project-name"
              autoComplete="off"
              placeholder="Demo shop"
              {...fieldAria("project-name", error, false)}
              {...form.register("name")}
            />
          </FormField>
          <DialogFooter>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
