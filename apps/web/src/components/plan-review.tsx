"use client";

import {
  type ApplyPlanBody,
  type ApplyPlanResponse,
  isLiftApiError,
  looksSecret,
  type OnboardingPlan,
  type PlanService,
  type PlanVariable,
} from "@lift/shared";
import { AlertTriangleIcon, Loader2Icon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { FormField, fieldAria } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useApplyPlan, usePlan } from "@/lib/hooks/use-plans";
import { useProjects } from "@/lib/hooks/use-projects";
import { showProblem } from "@/lib/problems";

/** The service's settings as the form holds them: commands as text, the port as typed. */
interface ServiceFields {
  name: string;
  rootDir: string;
  buildCommand: string;
  startCommand: string;
  port: string;
  healthcheckPath: string;
}

const fieldsOf = (service: PlanService): ServiceFields => ({
  name: service.name,
  rootDir: service.rootDir,
  buildCommand: service.buildCommand ?? "",
  startCommand: service.startCommand ?? "",
  port: String(service.port),
  healthcheckPath: service.healthcheckPath,
});

/** How a variable gets its value once the databases are chosen. */
type Filled = "lift" | "default" | "user";

export function filledBy(variable: PlanVariable, databaseOn: boolean): Filled {
  if (variable.source === "generated") return "lift";
  if (variable.source === "database") return databaseOn ? "lift" : "user";
  return variable.source === "default" ? "default" : "user";
}

const validPort = (port: string) =>
  /^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65_535;

/**
 * The apply body from the review screen: only the settings that changed, the databases left on,
 * and the values typed (a `default` only when it was edited). Empty optional values are left out.
 */
export function applyBody(
  plan: OnboardingPlan,
  input: {
    projectId: string | null;
    projectName: string;
    service: ServiceFields;
    databasesOn: boolean[];
    values: Record<string, string>;
  },
): ApplyPlanBody {
  const planned = plan.services[0];
  const databaseOn = input.databasesOn.some(Boolean);
  const service: NonNullable<ApplyPlanBody["service"]> = {};
  if (planned) {
    const { name, rootDir, buildCommand, startCommand, port, healthcheckPath } = input.service;
    if (name.trim() !== planned.name) service.name = name.trim();
    if (rootDir.trim() !== planned.rootDir) service.rootDir = rootDir.trim();
    if ((buildCommand.trim() || null) !== planned.buildCommand) {
      service.buildCommand = buildCommand.trim() || null;
    }
    if ((startCommand.trim() || null) !== planned.startCommand) {
      service.startCommand = startCommand.trim() || null;
    }
    if (Number(port) !== planned.port) service.port = Number(port);
    if (healthcheckPath.trim() !== planned.healthcheckPath) {
      service.healthcheckPath = healthcheckPath.trim();
    }
  }
  const values: ApplyPlanBody["values"] = [];
  for (const variable of plan.variables) {
    const typed = input.values[variable.key]?.trim() ?? "";
    const filled = filledBy(variable, databaseOn);
    if (filled === "lift" || typed === "") continue;
    if (filled === "default" && typed === variable.value) continue;
    values.push({ service: variable.service, key: variable.key, value: typed });
  }
  const projectName = input.projectName.trim();
  return {
    ...(input.projectId ? { projectId: input.projectId } : projectName ? { projectName } : {}),
    ...(Object.keys(service).length > 0 ? { service } : {}),
    databases: plan.databases.filter((_, index) => input.databasesOn[index]).map((db) => db.name),
    values,
  };
}

/** Where to go once the plan is applied: its first deployment, else the project. */
export function landingFor(result: ApplyPlanResponse): string {
  const service = result.project.services.find((candidate) => candidate.id === result.serviceId);
  return service?.latestDeployment
    ? `/p/${result.project.id}/deployments/${service.latestDeployment.id}`
    : `/p/${result.project.id}`;
}

const CONFIDENCE = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence: check every setting",
} as const;

/** /new/plan/[planId] (FE-14): the assistant's plan, to edit and approve. */
export function PlanReview({ planId }: { planId: string }) {
  const plan = usePlan(planId);
  if (plan.isPending) {
    return (
      <div className="flex max-w-5xl flex-col gap-4" aria-busy="true">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (plan.isError) {
    return (
      <div className="flex max-w-xl flex-col gap-3">
        <h1 className="font-heading font-semibold text-xl">This plan isn't available</h1>
        <p className="text-muted-foreground">
          {isLiftApiError(plan.error) && plan.error.status === 404
            ? "It doesn't exist, or someone else asked for it."
            : "Lift couldn't load it. Check your connection and try again."}
        </p>
        <Button asChild variant="secondary" className="w-fit">
          <Link href="/new">Deploy from GitHub</Link>
        </Button>
      </div>
    );
  }
  return <PlanForm plan={plan.data} />;
}

function PlanForm({ plan }: { plan: OnboardingPlan }) {
  const router = useRouter();
  const projectId = useSearchParams().get("project");
  const projects = useProjects();
  const target = projects.data?.data.find((project) => project.id === projectId);
  const planned = plan.services[0];
  const [projectName, setProjectName] = useState(plan.repo.name.slice(0, 64));
  const [service, setService] = useState<ServiceFields | null>(planned ? fieldsOf(planned) : null);
  const [databasesOn, setDatabasesOn] = useState(() => plan.databases.map(() => true));
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      plan.variables.map((variable) => [
        variable.key,
        variable.source === "default" ? (variable.value ?? "") : "",
      ]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const apply = useApplyPlan(plan.id);
  const databaseOn = databasesOn.some(Boolean);

  if (!planned || !service) {
    return <p className="text-muted-foreground">This plan has no service to create.</p>;
  }

  const missing = plan.variables.filter(
    (variable) =>
      variable.required &&
      filledBy(variable, databaseOn) !== "lift" &&
      (values[variable.key] ?? "").trim() === "",
  );
  const serviceReady =
    service.name.trim() !== "" &&
    validPort(service.port) &&
    service.healthcheckPath.trim().startsWith("/") &&
    service.rootDir.trim() !== "";
  const ready = missing.length === 0 && serviceReady && !apply.isPending;

  const setField = (field: keyof ServiceFields, value: string) =>
    setService((current) => (current ? { ...current, [field]: value } : current));

  function approve() {
    if (!service) return;
    setErrors({});
    apply.mutate(
      applyBody(plan, {
        projectId,
        projectName,
        service,
        databasesOn,
        values,
      }),
      {
        onSuccess: (result) => router.push(landingFor(result)),
        onError: (error) =>
          showProblem(error, (field, message) => {
            setErrors((current) => ({ ...current, [field]: message }));
            return true;
          }),
      },
    );
  }

  const serviceInput = (
    field: keyof ServiceFields,
    label: string,
    options: { hint?: string; placeholder?: string; mono?: boolean } = {},
  ) => {
    const id = `service-${field}`;
    const error = errors[`service.${field}`];
    return (
      <FormField id={id} label={label} hint={options.hint} error={error}>
        <Input
          id={id}
          value={service[field]}
          placeholder={options.placeholder}
          className={options.mono ? "font-mono" : undefined}
          onChange={(event) => setField(field, event.target.value)}
          {...fieldAria(id, error, Boolean(options.hint))}
        />
      </FormField>
    );
  };

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 font-heading font-semibold text-xl">
          <SparklesIcon className="size-5 text-muted-foreground" aria-hidden="true" />
          Review the plan
        </h1>
        <p className="text-muted-foreground">
          {plan.repo.owner}/{plan.repo.name} · {plan.repo.branch} ·{" "}
          <span className="font-mono">{plan.repo.commitSha.slice(0, 7)}</span>
        </p>
      </div>

      {/* On a phone: the summary first, then the form, then Approve. */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr]">
        <Card className="lg:col-start-2 lg:row-start-1">
          <CardHeader>
            <CardTitle>The assistant's summary</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm">{plan.summary}</p>
            <Badge
              variant={plan.confidence === "low" ? "destructive" : "secondary"}
              className="w-fit"
            >
              {CONFIDENCE[plan.confidence]}
            </Badge>
            {plan.warnings.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {plan.warnings.map((warning) => (
                  <li key={warning} className="flex gap-2 text-muted-foreground text-xs">
                    <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    {warning}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>

        <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <Card>
            <CardHeader>
              <CardTitle>Service</CardTitle>
              <CardDescription>{planned.rationale}</CardDescription>
            </CardHeader>
            <CardContent className="grid items-start gap-4 sm:grid-cols-2">
              {serviceInput("name", "Name")}
              {serviceInput("rootDir", "Root directory", { mono: true })}
              {serviceInput("buildCommand", "Build command", {
                mono: true,
                placeholder: "Railpack decides",
              })}
              {serviceInput("startCommand", "Start command", {
                mono: true,
                placeholder: "Railpack decides",
              })}
              {serviceInput("port", "Port", { hint: "Lift passes it to the app as PORT." })}
              {serviceInput("healthcheckPath", "Health check path", { mono: true })}
            </CardContent>
          </Card>

          {plan.databases.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Database</CardTitle>
                <CardDescription>
                  Lift sets DATABASE_URL on the service once it's ready.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {plan.databases.map((database, index) => (
                  <label key={database.name} className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 size-4 accent-primary"
                      checked={databasesOn[index] ?? false}
                      onChange={(event) =>
                        setDatabasesOn((current) =>
                          current.map((on, position) =>
                            position === index ? event.target.checked : on,
                          ),
                        )
                      }
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium">
                        Postgres <span className="font-mono">{database.name}</span>
                      </span>
                      <span className="text-muted-foreground text-xs">{database.rationale}</span>
                    </span>
                  </label>
                ))}
                {errors.databases ? (
                  <p className="text-destructive text-xs">{errors.databases}</p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Variables</CardTitle>
              <CardDescription>
                Values you type go straight into the service's encrypted variables.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col divide-y">
              {plan.variables.length === 0 ? (
                <p className="text-muted-foreground text-sm">The app reads no variables.</p>
              ) : (
                plan.variables.map((variable) => (
                  <VariableRow
                    key={variable.key}
                    variable={variable}
                    filled={filledBy(variable, databaseOn)}
                    value={values[variable.key] ?? ""}
                    error={errors[`values.${variable.key}`]}
                    onChange={(value) =>
                      setValues((current) => ({ ...current, [variable.key]: value }))
                    }
                  />
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="lg:col-start-2 lg:row-start-2">
          <CardHeader>
            <CardTitle>Project</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {projectId ? (
              <p className="text-sm">
                Adds the service to{" "}
                <span className="font-medium">{target?.name ?? "the project you chose"}</span>.
              </p>
            ) : (
              <FormField id="project-name" label="New project" error={errors.projectName}>
                <Input
                  id="project-name"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  {...fieldAria("project-name", errors.projectName, false)}
                />
              </FormField>
            )}
            <Button disabled={!ready} onClick={approve}>
              {apply.isPending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
              Approve and deploy
            </Button>
            {missing.length > 0 ? (
              <p className="text-muted-foreground text-xs">
                Fill in {missing.map((variable) => variable.key).join(", ")} first.
              </p>
            ) : !serviceReady ? (
              <p className="text-muted-foreground text-xs">Check the service's settings first.</p>
            ) : null}
            <Link
              href="/new"
              className="text-muted-foreground text-xs underline-offset-4 hover:underline"
            >
              Configure it manually instead
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function VariableRow({
  variable,
  filled,
  value,
  error,
  onChange,
}: {
  variable: PlanVariable;
  filled: Filled;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  const id = `value-${variable.key}`;
  return (
    <div className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-start">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={id} className="break-all font-mono text-sm">
            {variable.key}
          </label>
          {filled === "lift" ? (
            <Badge variant="secondary">Lift fills this</Badge>
          ) : filled === "default" ? (
            <Badge variant="outline">Default</Badge>
          ) : (
            <Badge variant="outline">You provide{variable.required ? "" : " (optional)"}</Badge>
          )}
        </div>
        {variable.description ? (
          <p className="text-muted-foreground text-xs">{variable.description}</p>
        ) : null}
      </div>
      {filled === "lift" ? (
        <p className="text-muted-foreground text-sm">
          {variable.source === "database"
            ? "From the Postgres database"
            : "A random secret Lift makes"}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <Input
            id={id}
            value={value}
            autoComplete="off"
            spellCheck={false}
            type={looksSecret(variable.key) ? "password" : "text"}
            className="font-mono"
            required={variable.required}
            onChange={(event) => onChange(event.target.value)}
            {...fieldAria(id, error, false)}
          />
          {error ? (
            <p id={`${id}-error`} className="text-destructive text-xs">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
