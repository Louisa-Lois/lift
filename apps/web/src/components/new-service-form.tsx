"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CreateServiceBody, isLiftApiError, SERVICE_DEFAULTS, type Service } from "@lift/shared";
import { PlusIcon } from "lucide-react";
import { useEffect } from "react";
import { Controller, type FieldPath, useForm } from "react-hook-form";
import { z } from "zod";
import { FormField, fieldAria } from "@/components/form-field";
import { NewProjectDialog } from "@/components/new-project-dialog";
import type { PickedRepo } from "@/components/repo-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formMessages } from "@/lib/form-errors";
import { useBranches } from "@/lib/hooks/use-github";
import { useProjects } from "@/lib/hooks/use-projects";
import { useCreateService } from "@/lib/hooks/use-services";
import { showProblem } from "@/lib/problems";

/** The form's values: the request body without `deploy` (always true here), plus the project. */
const NewServiceValues = CreateServiceBody.omit({ deploy: true }).extend({
  projectId: z.string().min(1, "Choose a project"),
});
type NewServiceInput = z.input<typeof NewServiceValues>;
type NewServiceOutput = z.output<typeof NewServiceValues>;

/** Problem `fields` this form can show next to an input; anything else becomes a toast. */
const FORM_FIELDS = new Set<string>([
  "projectId",
  "name",
  "repo",
  "repo.owner",
  "repo.name",
  "branch",
  "rootDir",
  "builder",
  "port",
]);

/** The branch to start on: the repo's default branch, else main or master, else the first. */
export function initialBranch(defaultBranch: string | null, branches: string[]): string {
  if (defaultBranch && (branches.length === 0 || branches.includes(defaultBranch))) {
    return defaultBranch;
  }
  return branches.find((name) => name === "main" || name === "master") ?? branches[0] ?? "";
}

/**
 * "Configure manually" on /new (FE-04): project, name, branch, root directory, port and builder
 * for the picked repo. Creates the service with `deploy: true`, then calls `onCreated`.
 */
export function NewServiceForm({
  repo,
  defaultProjectId,
  onCreated,
}: {
  repo: PickedRepo;
  defaultProjectId?: string | null;
  onCreated: (service: Service) => void;
}) {
  const projects = useProjects();
  const branches = useBranches(repo);
  const createService = useCreateService();
  const writable = (projects.data?.data ?? []).filter((project) => project.role !== "viewer");
  const branchNames = branches.data?.data.map((branch) => branch.name);

  const form = useForm<NewServiceInput, unknown, NewServiceOutput>({
    resolver: zodResolver(NewServiceValues, formMessages),
    defaultValues: {
      projectId: defaultProjectId ?? "",
      name: repo.name.slice(0, 64),
      repo: { owner: repo.owner, name: repo.name },
      branch: repo.defaultBranch ?? "",
      rootDir: SERVICE_DEFAULTS.rootDir,
      builder: SERVICE_DEFAULTS.builder,
      port: SERVICE_DEFAULTS.port,
    },
  });
  const { errors, isSubmitting } = form.formState;
  const branch = form.watch("branch");

  // Once the projects load: drop a project you can't deploy into, or pick your only one.
  // (While a new project is being refetched, its ID isn't in the list yet: wait.)
  const writableIds = writable.map((project) => project.id).join(",");
  useEffect(() => {
    if (!projects.isSuccess || projects.isFetching) return;
    const ids = writableIds ? writableIds.split(",") : [];
    const current = form.getValues("projectId");
    if (current && !ids.includes(current)) form.setValue("projectId", "");
    if (!form.getValues("projectId") && ids.length === 1) form.setValue("projectId", ids[0] ?? "");
  }, [projects.isSuccess, projects.isFetching, writableIds, form]);

  // Once the branches load, make sure the chosen one exists.
  const branchList = branchNames?.join("\n");
  useEffect(() => {
    if (branchList === undefined) return;
    const names = branchList ? branchList.split("\n") : [];
    if (!names.includes(form.getValues("branch"))) {
      form.setValue("branch", initialBranch(repo.defaultBranch, names));
    }
  }, [branchList, repo.defaultBranch, form]);

  const submit = form.handleSubmit(async ({ projectId, ...values }) => {
    try {
      const service = await createService.mutateAsync({
        projectId,
        body: { ...values, deploy: true },
      });
      onCreated(service);
    } catch (error) {
      let focused = false;
      showProblem(error, (field, message) => {
        if (!FORM_FIELDS.has(field)) return false;
        form.setError(
          field as FieldPath<NewServiceInput>,
          { type: "server", message },
          { shouldFocus: !focused },
        );
        focused = true;
        return true;
      });
    }
  });

  const repoError =
    errors.repo?.message ?? errors.repo?.owner?.message ?? errors.repo?.name?.message;
  const branchHint = branches.isError
    ? `Couldn't load the branches${isLiftApiError(branches.error) ? `: ${branches.error.detail || branches.error.title}` : ""}`
    : branchNames?.length === 0
      ? "This repo has no branches yet. Push a commit first."
      : "Lift deploys this branch.";
  const shownBranches = branchNames ?? (branch ? [branch] : []);

  return (
    <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-5">
      {repoError ? (
        <p role="alert" className="text-destructive">
          {repoError}
        </p>
      ) : null}

      <FormField id="service-project" label="Project" error={errors.projectId?.message}>
        <div className="flex gap-2">
          <Controller
            control={form.control}
            name="projectId"
            render={({ field }) => (
              <NativeSelect
                {...field}
                id="service-project"
                className="w-full"
                disabled={projects.isPending}
                {...fieldAria("service-project", errors.projectId?.message, false)}
              >
                <NativeSelectOption value="" disabled>
                  {projects.isPending
                    ? "Loading projects…"
                    : writable.length === 0
                      ? "No projects yet: create one"
                      : "Choose a project"}
                </NativeSelectOption>
                {writable.map((project) => (
                  <NativeSelectOption key={project.id} value={project.id}>
                    {project.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          />
          <NewProjectDialog
            trigger={
              <Button type="button" variant="outline" className="h-8">
                <PlusIcon aria-hidden="true" />
                New project
              </Button>
            }
            onCreated={(project) =>
              form.setValue("projectId", project.id, { shouldValidate: true })
            }
          />
        </div>
      </FormField>

      <FormField
        id="service-name"
        label="Service name"
        error={errors.name?.message}
        hint="Shown on the project page, and part of the service's address."
      >
        <Input
          id="service-name"
          autoComplete="off"
          {...fieldAria("service-name", errors.name?.message, true)}
          {...form.register("name")}
        />
      </FormField>

      <FormField
        id="service-branch"
        label="Branch"
        error={errors.branch?.message}
        hint={branchHint}
      >
        <Controller
          control={form.control}
          name="branch"
          render={({ field }) => (
            <NativeSelect
              {...field}
              id="service-branch"
              className="w-full"
              disabled={branches.isPending}
              {...fieldAria("service-branch", errors.branch?.message, true)}
            >
              {shownBranches.length === 0 ? (
                <NativeSelectOption value="" disabled>
                  {branches.isPending ? "Loading branches…" : "No branches"}
                </NativeSelectOption>
              ) : null}
              {shownBranches.map((name) => (
                <NativeSelectOption key={name} value={name}>
                  {name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          id="service-root"
          label="Root directory"
          error={errors.rootDir?.message}
          hint="The folder to build, relative to the repo. Use . for its root."
        >
          <Input
            id="service-root"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            {...fieldAria("service-root", errors.rootDir?.message, true)}
            {...form.register("rootDir")}
          />
        </FormField>
        <FormField
          id="service-port"
          label="Port"
          error={errors.port?.message}
          hint="Lift sets PORT to this. Your app must listen on it."
        >
          <Input
            id="service-port"
            type="number"
            inputMode="numeric"
            min={1}
            max={65535}
            className="font-mono"
            {...fieldAria("service-port", errors.port?.message, true)}
            {...form.register("port", { valueAsNumber: true })}
          />
        </FormField>
      </div>

      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 font-medium text-sm leading-none">Builder</legend>
        <Controller
          control={form.control}
          name="builder"
          render={({ field }) => (
            <RadioGroup
              value={field.value}
              onValueChange={field.onChange}
              className="grid gap-2 sm:grid-cols-2"
            >
              <Label
                htmlFor="builder-railpack"
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-[[data-state=checked]]:border-primary"
              >
                <RadioGroupItem id="builder-railpack" value="railpack" className="mt-0.5" />
                <span className="grid gap-1">
                  <span className="font-medium">Railpack</span>
                  <span className="text-muted-foreground text-xs">
                    Detects the language and framework, then builds it. No Dockerfile needed.
                  </span>
                </span>
              </Label>
              {/* Dockerfile builds arrive with INF-13 (Nov 23). */}
              <Label
                htmlFor="builder-dockerfile"
                className="flex cursor-not-allowed items-start gap-3 rounded-lg border p-3 font-normal opacity-60"
              >
                <RadioGroupItem
                  id="builder-dockerfile"
                  value="dockerfile"
                  disabled
                  className="mt-0.5"
                />
                <span className="grid gap-1">
                  <span className="flex items-center gap-2 font-medium">
                    Dockerfile
                    <Badge variant="outline" className="font-normal text-muted-foreground">
                      Coming soon
                    </Badge>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    Builds the repo's own Dockerfile.
                  </span>
                </span>
              </Label>
            </RadioGroup>
          )}
        />
      </fieldset>

      <div>
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? "Creating…" : "Create and deploy"}
        </Button>
      </div>
    </form>
  );
}
